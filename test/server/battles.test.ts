// Battles end to end through the app over node:sqlite: starting (team, wild creatures, pacing, one
// open battle), finishing (re-simulation, Perfect timing, the minimum duration, rewards, XP and
// evolution, streaks, the daily first win, tiredness), catching, abandoned battles, the rules
// version, the authorization matrix and touch. Duels, Rivals and revenge live in battles-duels.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { StartBattleRequest } from '../../plugin/hooks/core/api.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { cardStats, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { seasonOf, seasonStart, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import type { BattleSetup, Stats } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'

import { dayStart } from '../../server/src/game/ctx.ts'
import { cardsOf, ownCard } from '../../server/src/game/mint.ts'
import type { BattleRow } from '../../server/src/schema.ts'
import { DAY, HOUR, MINUTE, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

// ---- helpers -----------------------------------------------------------------------------------

const STRONG: Stats = { hp: 999, atk: 999, def: 999, spd: 999 }
const WEAK: Stats = { hp: 1, atk: 1, def: 1, spd: 1 }
/** Lasts the whole round limit: nobody faints, both sides chip 1 HP a hit, specials fire. */
const STEADY: Stats = { hp: 999, atk: 1, def: 999, spd: 999 }
const WILD = ECONOMY.battle.wildSpacingMs

/** Every card of the player battles with these stats until a battle saves it (saveCard recomputes them). */
const statsAll = (s: Server, p: Player, stats: Stats) =>
  s.db.batch([stmt('UPDATE cards SET stats = ? WHERE owner_id = ?', JSON.stringify(stats), p.id)])

const battleRow = async (s: Server, id: string) => (await s.db.get<BattleRow>('SELECT * FROM battles WHERE id = ?', id))!

/** When the server accepts a finish with these inputs: the rounds of its own replay, 1.5 s each. */
const readyAt = (start: { startedAt: number; setup: BattleSetup }, inputs: number[] = []) =>
  start.startedAt + simulateBattle(start.setup, inputs).rounds.length * ECONOMY.battle.minRoundMs

async function fight(s: Server, p: Player, req: StartBattleRequest, inputs: number[] = []) {
  const start = await p.call('startBattle', req)
  s.set(Math.max(s.now(), readyAt(start, inputs)))
  const fin = await p.call('finishBattle', { battleId: start.id, inputs })
  return { start, fin }
}

type Tunable = Record<string, Record<string, number>>
/** Runs fn with some ECONOMY numbers changed (catch, bounty, Mythic and roamer odds), then puts them back. */
async function tuned<T>(changes: Tunable, fn: () => Promise<T>): Promise<T> {
  const e = ECONOMY as unknown as Tunable
  const saved: [string, string, number][] = []
  for (const [section, values] of Object.entries(changes)) {
    for (const [key, value] of Object.entries(values)) {
      saved.push([section, key, e[section]![key]!])
      e[section]![key] = value
    }
  }
  try {
    return await fn()
  } finally {
    for (const [section, key, value] of saved) e[section]![key] = value
  }
}
const NO_SPECIAL_LEADS = { wild: { mythicChance: 0, roamerChance: 0 } }

/** Every table but the guard and migration bookkeeping, as one string. */
async function dump(db: Db): Promise<string> {
  const tables = await db.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('_guard', 'd1_migrations', 'sqlite_sequence') ORDER BY name`)
  const out: Record<string, unknown[]> = {}
  for (const { name } of tables) out[name] = await db.all(`SELECT * FROM ${name} ORDER BY 1`)
  return JSON.stringify(out)
}

const teamCards = async (s: Server, p: Player) => {
  const cards = new Map((await cardsOf(s.db, p.id)).map(c => [c.card.id, c]))
  return (await p.call('me')).player.team.map(id => cards.get(id)!)
}

// ---- starting ----------------------------------------------------------------------------------

describe('POST /v1/battles: a wild encounter', () => {
  it('battles the saved team against wild creatures of the season, in the arena, under today\'s rule and rules version', async () => {
    const s = server()
    const p = await s.join('opus')
    const team = await teamCards(s, p)
    const res = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    const w = worldOf(T0)
    assert.deepEqual(res.setup.attacker, team.map(c => toBattleCard(c.card)))
    assert.deepEqual([res.setup.kind, res.setup.arena, res.setup.rule, res.setup.rules], ['wild', 'haiku', w.rule, RULES_VERSION])
    assert.match(res.setup.seed, /^[0-9a-f]{32}$/)
    assert.deepEqual(res.opponent, { kind: 'wild' })
    assert.ok(res.setup.defender.length >= 1 && res.setup.defender.length <= 3)
    res.setup.defender.forEach((c, i) => {
      assert.equal(c.id, `wild-${i}`)
      if (c.species !== 'mythic') assert.equal(c.season, seasonOf(T0))
      assert.ok(Math.abs(c.level - 3) <= 1, 'within one level of the team')
    })
    assert.deepEqual(res.subs, [])
    assert.equal(res.startedAt, T0)
    assert.equal(res.finishAfter, readyAt(res))
    const taken = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
    assert.deepEqual(res.firstPossible, res.setup.defender.map(c => /^s\d+-/.test(c.species) && !taken.has(c.species)))

    const row = await battleRow(s, res.id)
    assert.deepEqual(
      [row.attacker_id, row.defender_id, row.kind, row.state, row.rules, row.finish_after, row.revenge],
      [p.id, null, 'wild', 'open', RULES_VERSION, res.finishAfter, 0],
    )
    assert.deepEqual(JSON.parse(row.setup), res.setup)
    const me = (await p.call('me')).player
    assert.deepEqual([me.nextWildAt, me.nextDuelAt], [T0 + WILD, 0])
  })

  it('makes a returning player\'s lead rare or better, judged by the server from the last battle start', async () => {
    await tuned(NO_SPECIAL_LEADS, async () => {
      const s = server()
      const p = await s.join()
      assert.equal(p.me.player.rested, false, 'a new player is not back from a break')
      const first = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
      s.set(first.finishAfter)
      await p.call('finishBattle', { battleId: first.id, inputs: [] })
      assert.equal((await p.call('me')).player.rested, false)
      s.set(first.startedAt + 4 * HOUR - 1)
      assert.equal((await p.call('me')).player.rested, false)
      s.tick(1)
      assert.equal((await p.call('me')).player.rested, true)
      const back = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
      assert.ok(['rare', 'epic'].includes(back.setup.defender[0]!.rarity), back.setup.defender[0]!.rarity)
      // days on, the sweep has forgotten when that was, which still reads as long ago
      s.tick(2 * DAY)
      await s.app.sweep(s.now())
      assert.deepEqual([(await p.row()).last_wild_at, (await p.call('me')).player.rested], [0, true])
    })
  })

  it('leads with a one-of-a-kind Mythic 1 time in 40, or this week\'s roamer', async () => {
    await tuned({ wild: { mythicChance: 1 } }, async () => {
      const s = server()
      const p = await s.join()
      const res = await p.call('startBattle', { kind: 'wild', family: 'fable' })
      const lead = res.setup.defender[0]!
      assert.deepEqual([lead.species, lead.form?.kind, lead.rarity, lead.foil, lead.stage], ['mythic', 'mythic', 'legendary', true, 3])
      assert.equal(res.firstPossible[0], false)
    })
    await tuned({ wild: { mythicChance: 0, roamerChance: 1 } }, async () => {
      const s = server()
      const p = await s.join()
      const lead = (await p.call('startBattle', { kind: 'wild', family: 'fable' })).setup.defender[0]!
      assert.deepEqual([lead.species, lead.rarity, lead.stage], [worldOf(T0).roamer, 'legendary', 3])
    })
  })

  it('spaces wild starts 8 minutes apart and duel starts 2, each with Retry-After', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STRONG)
    await fight(s, p, { kind: 'wild', family: 'haiku' })
    s.set(T0 + 7 * MINUTE)
    const early = await p.fails('startBattle', { kind: 'wild', family: 'haiku' })
    assert.deepEqual([early.status, early.code, early.headers.get('retry-after')], [429, 'rate_limited', '60'])
    await p.call('startBattle', { kind: 'duel', family: 'haiku' })
    s.tick(MINUTE)
    const duel = await p.fails('startBattle', { kind: 'duel', family: 'haiku' })
    assert.deepEqual([duel.status, duel.headers.get('retry-after')], [429, '60'])
    assert.ok(await p.call('startBattle', { kind: 'wild', family: 'haiku' }), 'the wild spacing is its own')
    s.tick(MINUTE)
    assert.ok(await p.call('startBattle', { kind: 'duel', family: 'haiku' }))
  })

  it('keeps one battle open: a new start settles the old one first, with no inputs and no catch', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STRONG)
    const old = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    s.tick(5000)
    const next = await p.call('startBattle', { kind: 'duel', family: 'haiku' })
    const row = await battleRow(s, old.id)
    assert.deepEqual([row.state, row.result, row.catch_options, row.setup], ['settled', 'win', null, '{}'])
    const me = (await p.call('me')).player
    assert.deepEqual([me.battles, me.sparks], [1, 110])
    assert.equal((await p.row()).wild_won, 0, 'beginner\'s luck waits for a win the player sees')
    assert.equal((await battleRow(s, next.id)).state, 'open')
    const open = await s.db.all('SELECT id FROM battles WHERE attacker_id = ? AND state = ?', p.id, 'open')
    assert.equal(open.length, 1)
  })

  it('lets only one of two racing starts through', async () => {
    const s = server()
    const p = await s.join()
    const both = await Promise.allSettled([1, 2].map(() => p.call('startBattle', { kind: 'duel', family: 'sonnet' })))
    assert.deepEqual(both.map(r => r.status).sort(), ['fulfilled', 'rejected'])
    assert.equal((await s.db.all('SELECT id FROM battles WHERE attacker_id = ?', p.id)).length, 1)
  })

  it('fills a tired, held or missing slot with the strongest free card, and says so', async () => {
    const s = server()
    const p = await s.join()
    for (const pack of p.me.packs) await p.call('openPack', { packId: pack.id })
    const team = p.me.player.team
    // the team (never the bench, whose order is by stored power) cannot faint while the battle is open
    for (const id of team) await s.db.batch([stmt('UPDATE cards SET stats = ? WHERE id = ?', JSON.stringify(STRONG), id)])
    await s.db.batch([
      stmt('UPDATE cards SET tired_until = ? WHERE id = ?', T0 + MINUTE, team[1]!),
      stmt(`UPDATE cards SET state = 'escrow', escrow_ref = 'o1' WHERE id = ?`, team[2]!),
    ])
    const bench = (await cardsOf(s.db, p.id)).filter(c => !team.includes(c.card.id))
    const best = bench.map(c => ({ id: c.card.id, power: (c.card.stats.hp + 2 * c.card.stats.atk + 2 * c.card.stats.def + c.card.stats.spd) }))
      .sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : 1))
    const res = await p.call('startBattle', { kind: 'duel', family: 'opus' })
    assert.deepEqual(res.subs, [{ slot: 1, cardId: best[0]!.id, replaced: team[1]! }, { slot: 2, cardId: best[1]!.id, replaced: team[2]! }])
    assert.deepEqual(res.setup.attacker.map(c => c.id), [team[0], best[0]!.id, best[1]!.id])

    await p.call('setTeam', { cardIds: [team[0]!] })
    s.tick(2 * MINUTE)
    const short = await p.call('startBattle', { kind: 'duel', family: 'opus' })
    assert.deepEqual(short.subs.map(x => [x.slot, x.replaced]), [[1, null], [2, null]])
  })

  it('refuses when nobody can battle: 429 until the first creature wakes, 403 when every card is held', async () => {
    const s = server()
    const p = await s.join()
    await s.db.batch([stmt('UPDATE cards SET tired_until = ? WHERE owner_id = ?', T0 + 5 * MINUTE, p.id)])
    const resting = await p.fails('startBattle', { kind: 'wild', family: 'haiku' })
    assert.deepEqual([resting.status, resting.code, resting.headers.get('retry-after')], [429, 'rate_limited', '300'])
    await s.db.batch([stmt(`UPDATE cards SET tired_until = 0, state = 'escrow' WHERE owner_id = ?`, p.id)])
    const held = await p.fails('startBattle', { kind: 'wild', family: 'haiku' })
    assert.deepEqual([held.status, held.code], [403, 'not_allowed'])
    assert.equal((await s.db.all('SELECT id FROM battles')).length, 0)
    assert.equal((await p.row()).last_wild_at, 0, 'a refused start uses up no spacing')
  })

  it('validates the request strictly', async () => {
    const s = server()
    const p = await s.join()
    for (const body of [
      {}, { kind: 'wild' }, { kind: 'boss', family: 'opus' }, { kind: 'wild', family: 'dragon' }, { kind: 'wild', family: 'opus', extra: 1 },
      { kind: 'duel', family: 'opus', revenge: 'a b' }, { kind: 'duel', family: 'opus', revenge: 7 }, { kind: 'wild', family: 'opus', revenge: 'brave-wren-41' },
    ]) {
      const res = await s.request('POST', '/v1/battles', { token: p.token, body })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    assert.equal((await s.request('POST', '/v1/battles', { body: { kind: 'wild', family: 'opus' } })).status, 401)
    assert.equal((await s.db.all('SELECT id FROM battles')).length, 0)
  })
})

// ---- finishing ---------------------------------------------------------------------------------

describe('POST /v1/battles/:id/finish', () => {
  it('re-simulates, pays the win and evolves the creature that fought, raised in the arena it fought in', async () => {
    const s = server()
    const p = await s.join('opus')
    await statsAll(s, p, STRONG)
    const { start, fin } = await fight(s, p, { kind: 'wild', family: 'haiku' })
    assert.deepEqual(fin.log, simulateBattle(start.setup, []))
    assert.equal(fin.result, 'win')
    assert.deepEqual([fin.sparks, fin.rating, fin.ratingDelta, fin.streak, fin.streakPack, fin.dailyWinPack, fin.bounty, fin.tired], [10, 1000, 0, 1, false, true, null, []])
    const lead = start.setup.attacker[0]!
    assert.deepEqual(fin.xp, [{ cardId: lead.id, xp: 20, levelsGained: 1, evolved: true, stage: 2 }], 'only the lead took part')
    const grown = await ownCard(s.db, p.id, lead.id)
    assert.deepEqual([grown.card.level, grown.card.xp, grown.card.stage, grown.card.raisedIn], [4, 0, 2, 'haiku'])
    assert.deepEqual(grown.arena, { haiku: 1, sonnet: 0, opus: 0, fable: 0 })
    assert.deepEqual(grown.card.stats, cardStats(grown.card), 'stats are the server\'s again')
    const benchedId = start.setup.attacker[1]!.id
    assert.deepEqual((await ownCard(s.db, p.id, benchedId)).arena, { haiku: 0, sonnet: 0, opus: 0, fable: 0 })

    const me = await p.call('me')
    assert.deepEqual([me.player.sparks, me.player.battles, me.player.streak], [110, 1, 1])
    assert.deepEqual(me.packs.filter(k => k.source === 'daily').map(k => [k.family, k.day]), [['haiku', utcDay(s.now())]])
    assert.equal(me.player.cardsVersion > p.me.player.cardsVersion, true)
    const row = await battleRow(s, start.id)
    assert.deepEqual([row.state, row.result, row.settled, row.setup, row.opponent], ['settled', 'win', utcDay(s.now()), '{}', '{}'])
  })

  it('raises a creature at home when its own family\'s arena is where it fought most', async () => {
    const s = server()
    const p = await s.join('opus')
    await statsAll(s, p, STRONG)
    const home = (await ownCard(s.db, p.id, p.me.player.team[0]!)).card.family
    const { start } = await fight(s, p, { kind: 'wild', family: home })
    const lead = await ownCard(s.db, p.id, start.setup.attacker[0]!.id)
    assert.deepEqual([lead.card.stage, lead.card.raisedIn, lead.arena[home]], [2, home, 1])
  })

  it('makes a press Perfect only on the rounds the attacker\'s special fires, exactly as the client simulates', async () => {
    const s = server()
    const p = await s.join('sonnet')
    await statsAll(s, p, STEADY)
    const start = await p.call('startBattle', { kind: 'wild', family: 'sonnet' })
    const plain = simulateBattle(start.setup, [])
    const inputs = plain.rounds.map(r => r.round)
    s.set(readyAt(start, inputs))
    const fin = await p.call('finishBattle', { battleId: start.id, inputs })
    assert.deepEqual(fin.log, simulateBattle(start.setup, inputs))
    const actions = fin.log.rounds.flatMap(r => r.actions)
    const specials = actions.filter(a => a.side === 'a' && a.move === 'special')
    assert.ok(specials.length >= 2, 'a battle of the whole round limit has specials')
    assert.ok(specials.every(a => a.perfect === true))
    assert.ok(actions.filter(a => a.side === 'd' || a.move === 'attack').every(a => a.perfect === undefined))
  })

  it('refuses a finish sooner than the replay could have played, with conflict and Retry-After', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STEADY)
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    s.set(start.finishAfter - 1)
    const early = await p.fails('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual([early.status, early.code, early.headers.get('retry-after')], [409, 'conflict', '1'])
    assert.equal((await battleRow(s, start.id)).state, 'open')
    s.tick(1)
    assert.ok(await p.call('finishBattle', { battleId: start.id, inputs: [] }))
  })

  it('pays once, answers a repeated finish with the same result, and refuses an abandoned or unreadable one', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STRONG)
    const { start, fin } = await fight(s, p, { kind: 'wild', family: 'haiku' })
    const paid = await p.row()
    assert.ok(fin.catchOptions.length, 'the first wild win catches')
    // the answer was lost on the way: asking again gets it again, catch and all, and pays nothing more
    assert.deepEqual(await p.call('finishBattle', { battleId: start.id, inputs: [1, 2] }), fin)
    assert.deepEqual(await p.row(), paid)
    await p.call('catchCreature', { battleId: start.id, index: 0 })
    assert.deepEqual(await p.call('finishBattle', { battleId: start.id, inputs: [] }), { ...fin, catchOptions: [] }, 'caught: nothing waits any more')
    s.tick(WILD)
    const next = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    assert.equal((await battleRow(s, start.id)).outcome, null, 'kept only until the next battle')
    assert.equal((await p.fails('finishBattle', { battleId: start.id, inputs: [] })).code, 'conflict')
    s.set(next.finishAfter)
    await p.call('finishBattle', { battleId: next.id, inputs: [] })

    s.tick(WILD)
    const late = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    s.set(late.startedAt + ECONOMY.battle.abandonMs)
    assert.equal((await p.fails('finishBattle', { battleId: late.id, inputs: [] })).code, 'conflict')

    await s.db.batch([stmt(
      `INSERT INTO battles (id, attacker_id, kind, setup, opponent, started_at) VALUES ('broken', ?, 'wild', '{"nope":1}', '{}', ?)`, p.id, s.now(),
    )])
    assert.equal((await p.fails('finishBattle', { battleId: 'broken', inputs: [] })).code, 'conflict')
    assert.deepEqual([(await battleRow(s, 'broken')).state, (await battleRow(s, 'broken')).result], ['settled', null])
  })

  it('pays once when two finishes race, and both get the one result', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STRONG)
    const start = await p.call('startBattle', { kind: 'duel', family: 'opus' })
    s.set(start.finishAfter)
    const [one, two] = await Promise.all([1, 2].map(() => p.call('finishBattle', { battleId: start.id, inputs: [] })))
    assert.deepEqual(one, two)
    const row = await p.row()
    assert.deepEqual([row.battles, row.sparks, row.streak], [1, 112, 1])
  })

  it('validates inputs: rounds 1-30, strictly increasing, at most 30', async () => {
    const s = server()
    const p = await s.join()
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    s.set(start.finishAfter)
    for (const inputs of [[0], [31], [2, 2], [3, 1], [1.5], ['1'], Array.from({ length: 31 }, (_, i) => i + 1)]) {
      const res = await s.request('POST', `/v1/battles/${start.id}/finish`, { token: p.token, body: { inputs } })
      assert.equal(res.status, 400, JSON.stringify(inputs))
    }
    assert.equal((await s.request('POST', `/v1/battles/${start.id}/finish`, { token: p.token, body: { inputs: [], more: 1 } })).status, 400)
    assert.equal((await s.request('POST', '/v1/battles/no*such/finish', { token: p.token, body: { inputs: [] } })).status, 400)
    assert.equal((await battleRow(s, start.id)).state, 'open')
    assert.ok(await p.call('finishBattle', { battleId: start.id, inputs: Array.from({ length: 30 }, (_, i) => i + 1) }))
  })

  it('pays a loss, tires the creatures that fainted for 15 minutes and resets the streak', async () => {
    const s = server()
    const p = await s.join()
    await s.db.batch([stmt('UPDATE players SET streak = 2 WHERE id = ?', p.id)])
    await statsAll(s, p, WEAK)
    const { start, fin } = await fight(s, p, { kind: 'wild', family: 'haiku' })
    const done = s.now()
    assert.equal(fin.result, 'loss')
    assert.deepEqual([fin.sparks, fin.streak, fin.dailyWinPack, fin.catchOptions], [3, 0, false, []])
    assert.deepEqual(fin.tired, start.setup.attacker.map(c => c.id))
    assert.ok(fin.xp.every(x => x.xp === 8 && x.levelsGained === 0))
    for (const c of await cardsOf(s.db, p.id)) assert.equal(c.card.tiredUntil, done + 15 * MINUTE)
    const resting = await p.fails('startBattle', { kind: 'duel', family: 'haiku' })
    assert.deepEqual([resting.code, resting.headers.get('retry-after')], ['rate_limited', String(15 * 60)])
    s.tick(15 * MINUTE)
    assert.ok(await p.call('startBattle', { kind: 'duel', family: 'haiku' }))
    assert.equal((await p.fails('catchCreature', { battleId: start.id, index: 0 })).code, 'conflict', 'a lost wild team wanders off')
  })

  it('pays a streak pack on every 3rd win in a row and the first win of each UTC day', async () => {
    const s = server()
    const p = await s.join()
    const results = []
    for (let i = 0; i < 4; i++) {
      await statsAll(s, p, STRONG)
      const { fin } = await fight(s, p, { kind: 'duel', family: 'fable' })
      results.push([fin.streak, fin.streakPack, fin.dailyWinPack])
      s.tick(2 * MINUTE)
    }
    assert.deepEqual(results, [[1, false, true], [2, false, false], [3, true, false], [4, false, false]])
    const packs = (await p.call('me')).packs
    assert.deepEqual(packs.filter(k => k.source === 'streak').map(k => k.family), ['fable'])
    assert.equal(packs.filter(k => k.source === 'daily').length, 1)
    s.set(dayStart(utcDay(s.now())) + DAY)
    await statsAll(s, p, STRONG)
    assert.equal((await fight(s, p, { kind: 'duel', family: 'fable' })).fin.dailyWinPack, true)
  })

  it('gives XP only to cards still the player\'s, held ones included, and nothing to one traded away', async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    await statsAll(s, p, STEADY)
    const [a, b] = p.me.player.team
    // the lead faints at once, so the second card fights too
    await s.db.batch([stmt('UPDATE cards SET stats = ? WHERE id = ?', JSON.stringify(WEAK), a!)])
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    await s.db.batch([
      stmt('UPDATE cards SET owner_id = ? WHERE id = ?', q.id, a!),
      stmt(`UPDATE cards SET state = 'escrow', escrow_ref = 'o1' WHERE id = ?`, b!),
    ])
    s.set(start.finishAfter)
    const fin = await p.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual(fin.xp.map(x => x.cardId), [b])
    assert.deepEqual(fin.tired, [], 'a card no longer theirs is not tired either')
    const kept = await ownCard(s.db, q.id, a!)
    assert.deepEqual([kept.card.xp, kept.card.tiredUntil, kept.version], [100, 0, 0], 'the traded card is untouched')
    const held = await ownCard(s.db, p.id, b!)
    assert.deepEqual([held.card.state, held.escrowRef, held.version], ['escrow', 'o1', 1])
    assert.ok(held.card.level > 3 || held.card.xp > 100, 'the held card grew')
  })

  it('tires the creatures that fainted only after a draw or a loss: a win tires nobody (SPEC 5, Outcomes)', async () => {
    const s = server()
    const p = await s.join()
    await statsAll(s, p, STRONG)
    await s.db.batch([stmt('UPDATE cards SET stats = ? WHERE id = ?', JSON.stringify(WEAK), p.me.player.team[0]!)])
    const { fin } = await fight(s, p, { kind: 'wild', family: 'haiku' })
    assert.equal(fin.result, 'win')
    assert.ok(fin.log.fainted.a.includes(0), 'the lead fainted')
    assert.deepEqual(fin.tired, [])
    for (const c of await cardsOf(s.db, p.id)) assert.equal(c.card.tiredUntil, 0)
  })

  it('never replays a battle of another rules version with today\'s rules: it closes with nothing paid', async () => {
    const s = server()
    const p = await s.join()
    const start = await p.call('startBattle', { kind: 'duel', family: 'opus' })
    await s.db.batch([stmt('UPDATE battles SET rules = ? WHERE id = ?', RULES_VERSION + 1, start.id)])
    const before = await p.row()
    s.set(start.finishAfter)
    assert.equal((await p.fails('finishBattle', { battleId: start.id, inputs: [] })).code, 'conflict')
    const row = await battleRow(s, start.id)
    assert.deepEqual([row.state, row.result, row.setup], ['settled', null, '{}'])
    assert.deepEqual([(await p.row()).battles, (await p.row()).sparks], [before.battles, before.sparks])
  })
})

// ---- catching ----------------------------------------------------------------------------------

describe('POST /v1/battles/:id/catch', () => {
  it('always catches on the first wild win ever, then rolls the catch chance', async () => {
    await tuned({ battle: { catchChance: 0 }, ...NO_SPECIAL_LEADS }, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const first = await fight(s, p, { kind: 'wild', family: 'haiku' })
      assert.deepEqual(first.fin.catchOptions, first.start.setup.defender)
      assert.equal((await p.row()).wild_won, 1)
      s.tick(WILD)
      await statsAll(s, p, STRONG)
      const second = await fight(s, p, { kind: 'wild', family: 'haiku' })
      assert.deepEqual([second.fin.result, second.fin.catchOptions], ['win', []])
    })
  })

  it('offers only the creatures a win defeated: a win on the round limit defeats none, and beginner\'s luck waits', async () => {
    const s = server()
    const p = await s.join()
    // chips of 2 against 999 HP: the attacker wins on the HP fraction at round 20 and nobody faints
    await statsAll(s, p, { hp: 999, atk: 50, def: 999, spd: 999 })
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    const setup = JSON.parse((await battleRow(s, start.id)).setup) as BattleSetup
    for (const c of setup.defender) c.stats = { hp: 999, atk: 1, def: 999, spd: 1 }
    await s.db.batch([stmt('UPDATE battles SET setup = ? WHERE id = ?', JSON.stringify(setup), start.id)])
    s.set(Math.max(start.finishAfter, readyAt({ startedAt: start.startedAt, setup })))
    const fin = await p.call('finishBattle', { battleId: start.id, inputs: [] })
    assert.deepEqual([fin.result, fin.log.fainted.d, fin.catchOptions], ['win', [], []])
    assert.equal((await p.row()).wild_won, 0, 'the first win that catches is still to come')

    s.tick(WILD)
    await statsAll(s, p, STRONG)
    const next = await fight(s, p, { kind: 'wild', family: 'haiku' })
    const defeated = next.start.setup.defender.filter((_, i) => next.fin.log.fainted.d.includes(i))
    assert.ok(defeated.length)
    assert.deepEqual(next.fin.catchOptions, defeated)
    assert.equal((await p.row()).wild_won, 1)
  })

  it('turns the picked wild creature into a card with the same DNA, once, within 10 minutes', async () => {
    await tuned(NO_SPECIAL_LEADS, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const { start, fin } = await fight(s, p, { kind: 'wild', family: 'sonnet' })
      const index = fin.catchOptions.length - 1
      const wild = fin.catchOptions[index]!
      const before = (await p.call('me')).player.cardsVersion
      const { card } = await p.call('catchCreature', { battleId: start.id, index })
      assert.deepEqual(
        [card.species, card.dna, card.genes, card.traits, card.level, card.rarity, card.shiny],
        [wild.species, wild.dna, wild.genes, wild.traits, wild.level, wild.rarity, wild.shiny],
      )
      assert.deepEqual([card.origin, card.xp, card.bound, card.state, card.mintedAt], ['catch', 0, false, 'owned', dayStart(utcDay(s.now()))])
      assert.deepEqual(card.stats, cardStats(card))
      assert.equal((await ownCard(s.db, p.id, card.id)).card.id, card.id)
      const me = (await p.call('me')).player
      assert.ok(me.seen.includes(wild.species))
      assert.ok(me.cardsVersion > before)
      assert.equal((await p.fails('catchCreature', { battleId: start.id, index })).code, 'conflict')
    })
  })

  it('mints one card when two catches race', async () => {
    await tuned(NO_SPECIAL_LEADS, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const { start } = await fight(s, p, { kind: 'wild', family: 'opus' })
      const both = await Promise.allSettled([0, 0].map(index => p.call('catchCreature', { battleId: start.id, index })))
      assert.deepEqual(both.map(r => r.status).sort(), ['fulfilled', 'rejected'])
      assert.equal((await cardsOf(s.db, p.id)).filter(c => c.card.origin === 'catch').length, 1)
    })
  })

  it('refuses a catch before the finish, past the window, or beyond the creatures there were', async () => {
    await tuned(NO_SPECIAL_LEADS, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
      assert.equal((await p.fails('catchCreature', { battleId: start.id, index: 0 })).code, 'conflict')
      s.set(start.finishAfter)
      const fin = await p.call('finishBattle', { battleId: start.id, inputs: [] })
      if (fin.catchOptions.length < 3) {
        const beyond = await p.fails('catchCreature', { battleId: start.id, index: 2 })
        assert.deepEqual([beyond.status, beyond.code], [400, 'bad_request'])
      }
      assert.equal((await s.request('POST', `/v1/battles/${start.id}/catch`, { token: p.token, body: { index: 3 } })).status, 400)
      s.tick(ECONOMY.battle.catchWindowMs)
      const late = await p.fails('catchCreature', { battleId: start.id, index: 0 })
      assert.deepEqual([late.status, late.code], [410, 'expired'])
      assert.equal((await cardsOf(s.db, p.id)).length, 3)
    })
  })

  it('stamps a caught Mythic with its finder and lists it; one that got away is gone for good', async () => {
    await tuned({ wild: { mythicChance: 1 } }, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const { start } = await fight(s, p, { kind: 'wild', family: 'opus' })
      const { card } = await p.call('catchCreature', { battleId: start.id, index: 0 })
      assert.deepEqual([card.species, card.form?.discoveredBy, card.rarity, card.foil, card.stage], ['mythic', p.me.player.handle, 'legendary', true, 3])
      assert.deepEqual(await s.db.get('SELECT name, finder_id FROM mythics WHERE card_id = ?', card.id), { name: card.form!.names[2], finder_id: p.id })

      s.tick(WILD)
      const fled = await p.call('startBattle', { kind: 'wild', family: 'opus' })
      s.tick(ECONOMY.battle.abandonMs)
      await p.call('me')
      const row = await battleRow(s, fled.id)
      assert.deepEqual([row.state, row.catch_options, row.setup], ['settled', null, '{}'])
      assert.equal((await p.fails('catchCreature', { battleId: fled.id, index: 0 })).code, 'conflict')
    })
  })

  it('never catches in a duel, and a duel win may pay a bounty of the opponent\'s lead species', async () => {
    await tuned({ battle: { bountyChance: 1 } }, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      const { start, fin } = await fight(s, p, { kind: 'duel', family: 'haiku' })
      assert.deepEqual(fin.catchOptions, [])
      assert.equal(fin.bounty!.species, start.setup.defender[0]!.species)
      assert.deepEqual([fin.bounty!.origin, fin.bounty!.xp, fin.bounty!.level], ['bounty', 0, 1])
      assert.equal((await ownCard(s.db, p.id, fin.bounty!.id)).owner, p.id)
      s.tick(WILD)
      await statsAll(s, p, STRONG)
      assert.equal((await fight(s, p, { kind: 'wild', family: 'haiku' })).fin.bounty, null, 'wild wins pay no bounty')
    })
    await tuned({ battle: { bountyChance: 0 } }, async () => {
      const s = server()
      const p = await s.join()
      await statsAll(s, p, STRONG)
      assert.equal((await fight(s, p, { kind: 'duel', family: 'haiku' })).fin.bounty, null)
    })
  })
})

// ---- abandoned battles and touch ---------------------------------------------------------------

describe('abandoned battles and touch', () => {
  it('settle with no inputs on the attacker\'s next request 10 minutes on, with notices for what they missed', async () => {
    const s = server()
    const p = await s.join('opus')
    await statsAll(s, p, STRONG)
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    s.tick(ECONOMY.battle.abandonMs - 1)
    await p.call('me')
    assert.equal((await battleRow(s, start.id)).state, 'open')
    s.tick(1)
    const me = await p.call('me')
    const row = await battleRow(s, start.id)
    assert.deepEqual([row.state, row.result, row.catch_options], ['settled', 'win', null])
    assert.deepEqual([me.player.battles, me.player.sparks, me.player.streak], [1, 110, 1])
    assert.deepEqual(me.notices.map(n => n.kind).sort(), ['daily-pack', 'evolved'])
    assert.match(me.notices.find(n => n.kind === 'evolved')!.text, /^\S.* evolved into \S.*!$/)
    assert.equal((await p.row()).wild_won, 0)
    const lead = await ownCard(s.db, p.id, start.setup.attacker[0]!.id)
    assert.deepEqual([lead.card.stage, lead.card.raisedIn], [2, 'haiku'])
  })

  it('cost nothing when no battle is due, and close a row that cannot be replayed instead of failing every request', async () => {
    const s = server()
    const p = await s.join()
    const version = (await p.row()).version
    await p.call('me')
    assert.equal((await p.row()).version, version)
    await s.db.batch([stmt(
      `INSERT INTO battles (id, attacker_id, kind, setup, opponent, started_at) VALUES ('legacy', ?, 'wild', '{}', '{}', ?)`, p.id, T0 - HOUR,
    )])
    const me = await p.call('me')
    assert.equal(me.player.battles, 0)
    const row = await battleRow(s, 'legacy')
    assert.deepEqual([row.state, row.result, row.settled], ['settled', null, utcDay(T0)])
  })

  it('turns the season exactly once, however many requests race into the new season', async () => {
    const s = server()
    const p = await s.join()
    await s.db.batch([stmt('UPDATE players SET rating = 1720 WHERE id = ?', p.id)])
    s.set(seasonStart(2) + HOUR)
    const answers = await Promise.allSettled(Array.from({ length: 6 }, () => p.call('me')))
    assert.ok(answers.some(a => a.status === 'fulfilled'))
    const me = await p.call('me')
    assert.equal(me.packs.filter(k => k.source === 'season').length, 5)
    assert.equal(me.notices.filter(n => n.kind === 'season-end').length, 1)
    assert.equal(me.player.rating, 1360)
    assert.equal((await cardsOf(s.db, p.id)).filter(c => c.card.origin === 'season').length, 1)
    assert.equal((await p.row()).season, 2)
  })
})

// ---- authorization (SPEC 26) -------------------------------------------------------------------

describe('authorization matrix', () => {
  it('answers 404 for another player\'s battle on finish and catch, exactly as for none, and changes nothing', async () => {
    await tuned(NO_SPECIAL_LEADS, async () => {
      const s = server()
      const owner = await s.join()
      const other = await s.join()
      await statsAll(s, owner, STRONG)
      const caught = await fight(s, owner, { kind: 'wild', family: 'haiku' })
      assert.ok(caught.fin.catchOptions.length > 0)
      s.tick(2 * MINUTE)
      const open = await owner.call('startBattle', { kind: 'duel', family: 'haiku' })
      s.set(open.finishAfter)
      const before = await dump(s.db)
      const tries = [
        await other.fails('finishBattle', { battleId: open.id, inputs: [] }),
        await other.fails('finishBattle', { battleId: caught.start.id, inputs: [] }),
        await other.fails('catchCreature', { battleId: caught.start.id, index: 0 }),
        await other.fails('catchCreature', { battleId: open.id, index: 0 }),
      ]
      const missing = [
        await other.fails('finishBattle', { battleId: 'a'.repeat(26), inputs: [] }),
        await other.fails('catchCreature', { battleId: 'b'.repeat(26), index: 0 }),
      ]
      for (const f of [...tries, ...missing]) assert.deepEqual([f.status, f.code, f.message], [404, 'not_found', missing[0]!.message])
      assert.equal(await dump(s.db), before, 'no table changed')
      assert.ok(await owner.call('finishBattle', { battleId: open.id, inputs: [] }))
      assert.ok(await owner.call('catchCreature', { battleId: caught.start.id, index: 0 }))
    })
  })
})

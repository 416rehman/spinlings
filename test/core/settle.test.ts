// The one settling plan both worlds apply (SPEC 5, 13, 14, 28): what a finished battle pays, the catch among the
// defeated, the bounty, rating, and the notices an auto settle leaves.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BattleCard, BattleSetup, Card } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, eloDelta, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { cardName, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { BATTLE_TEXT, settlePlan } from '../../plugin/hooks/core/settle.ts'
import type { HeldCard, SettleInput } from '../../plugin/hooks/core/settle.ts'
import { card, NOW, speciesOf } from './helpers.ts'

const B = ECONOMY.battle
const counts = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
const weak = (c: BattleCard): BattleCard => ({ ...c, stats: { hp: 1, atk: 1, def: 1, spd: 1 } })
const mighty = (c: BattleCard): BattleCard => ({ ...c, stats: { hp: 9000, atk: 900, def: 900, spd: 900 } })

/** Three level-3 cards one win from evolving, and a fight whose outcome the stats fix. */
function fight(kind: BattleSetup['kind'], outcome: 'win' | 'loss', over: Partial<SettleInput<HeldCard>> = {}) {
  const mine: Card[] = [0, 1, 2].map(i => card(speciesOf('opus', i), { id: `a${i}`, level: 3, xp: 100 }, i + 1))
  const theirs = [0, 1].map(i => toBattleCard(card(speciesOf('haiku', i), { id: `d${i}` }, i + 10)))
  const team = mine.map(toBattleCard)
  const setup: BattleSetup = {
    seed: 'settle', kind, arena: 'fable', rule: 'calm', rules: RULES_VERSION,
    attacker: outcome === 'win' ? team.map(mighty) : team.map(weak), defender: outcome === 'win' ? theirs.map(weak) : theirs.map(mighty),
  }
  const log = simulateBattle(setup, [])
  assert.equal(log.result, outcome)
  const input: SettleInput<HeldCard> = {
    setup, log, mode: 'finish', now: NOW, finishAfter: NOW - 60_000, rng: rngFromSeed('settle'),
    held: new Map(mine.map(c => [c.id, { card: c, arena: { ...counts } }])), streak: 2, rating: 1000, opponentRating: null,
    wildWon: true, firstWinDue: true, revenge: false, ...over,
  }
  return { input, plan: settlePlan(input) }
}

test('a win pays sparks and XP, evolves and raises in the arena, continues the streak and brings its packs', () => {
  const { input, plan } = fight('wild', 'win')
  const { answer } = plan
  assert.deepEqual([answer.result, answer.sparks, answer.streak, answer.streakPack, answer.dailyWinPack], ['win', B.sparks.win, 3, true, true])
  assert.deepEqual(answer.xp, [{ cardId: 'a0', xp: B.xp.win, levelsGained: 1, evolved: true, stage: 2 }])
  assert.deepEqual(plan.cards.map(c => [c.held.card.id, c.next.level, c.next.stage, c.next.raisedIn, c.arena.fable]), [['a0', 4, 2, 'fable', 1]])
  assert.deepEqual([answer.rating, answer.ratingDelta, plan.defenderDelta, answer.tired], [1000, 0, 0, []])
  assert.deepEqual(plan.notices, [], 'a finish is watched: its news is the answer')
  assert.equal(answer.log, input.log)
})

test('a catch is offered among the defeated only, on a finished wild win; beginner\'s luck goes once one is', () => {
  const lucky = fight('wild', 'win', { wildWon: false })
  assert.deepEqual(lucky.plan.answer.catchOptions, lucky.input.setup.defender, 'the first wild win always catches')
  assert.equal(lucky.plan.luckSpent, true)
  const auto = fight('wild', 'win', { wildWon: false, mode: 'auto' })
  assert.deepEqual([auto.plan.answer.catchOptions, auto.plan.luckSpent], [[], false], 'nobody there to pick')
  for (let i = 0; i < 40; i++) {
    const { input, plan } = fight('wild', 'win', { rng: rngFromSeed('catch/' + i) })
    for (const o of plan.answer.catchOptions) assert.ok(input.log.fainted.d.includes(input.setup.defender.indexOf(o)))
    assert.equal(plan.luckSpent, false)
    assert.equal(plan.bounty, null, 'wild battles pay no bounty')
  }
  assert.deepEqual(fight('wild', 'loss', { wildWon: false }).plan.answer.catchOptions, [])
})

test('an auto settle tells what nobody watched, in the server\'s words', () => {
  const { plan } = fight('wild', 'win', { mode: 'auto' })
  const lead = plan.cards[0]!
  assert.deepEqual(plan.notices, [
    { kind: 'evolved', text: BATTLE_TEXT.evolved(cardName(lead.held.card), cardName(lead.next)) },
    { kind: 'streak-pack', text: BATTLE_TEXT.streakPack(3) },
    { kind: 'daily-pack', text: BATTLE_TEXT.dailyPack() },
  ])
  assert.notEqual(cardName(lead.held.card), cardName(lead.next))
})

test('a loss ends the streak and rests the fainted from the battle\'s end; rating moves only against a rating', () => {
  const { input, plan } = fight('duel', 'loss', { opponentRating: 1200 })
  const { answer } = plan
  assert.deepEqual([answer.sparks, answer.streak, answer.streakPack, answer.dailyWinPack, plan.bounty], [B.sparks.loss, 0, false, false, null])
  const elo = eloDelta(1000, 1200, 'loss')
  assert.deepEqual([answer.ratingDelta, answer.rating, plan.defenderDelta], [elo.attacker, 1000 + elo.attacker, elo.defender])
  assert.deepEqual(answer.tired, input.log.fainted.a.map(i => `a${i}`))
  for (const c of plan.cards) assert.equal(c.next.tiredUntil, NOW + B.tiredMs)
  const auto = fight('duel', 'loss', { mode: 'auto' }).plan
  for (const c of auto.cards) assert.equal(c.next.tiredUntil, NOW - 60_000 + B.tiredMs, 'an auto settle rests them from its earliest finish')
  assert.equal(fight('duel', 'loss').plan.answer.ratingDelta, 0, 'outside the pair limit')
})

test('a duel win may roll a bounty of the opponent\'s lead; a card that left the collection earns nothing', () => {
  let bounties = 0
  for (let i = 0; i < 200; i++) {
    const { plan } = fight('duel', 'win', { rng: rngFromSeed('bounty/' + i) })
    if (!plan.bounty) continue
    bounties++
    assert.deepEqual([plan.bounty.origin, plan.bounty.family], ['bounty', 'haiku'])
  }
  assert.ok(bounties > 15 && bounties < 70, `${bounties} of 200`)
  const gone = fight('duel', 'win', { held: new Map() }).plan
  assert.deepEqual([gone.cards, gone.answer.xp], [[], []])
})

test('a duel that moves no rating (a challenge, or past the pair limit) pays like a loss: no bounty, packs or streak', () => {
  const always = () => 0 // every roll hits
  const full = fight('duel', 'win', { rng: always, opponentRating: 1000 })
  assert.ok(full.plan.bounty, 'a counted duel win rolls the bounty')
  assert.deepEqual([full.plan.answer.sparks, full.plan.answer.streak, full.plan.answer.streakPack, full.plan.answer.dailyWinPack],
    [B.sparks.duelWin, 3, true, true])
  const friendly = fight('duel', 'win', { rng: always, counts: false, revenge: true })
  const { answer } = friendly.plan
  assert.deepEqual([answer.result, answer.sparks, answer.ratingDelta, answer.streak, answer.streakPack, answer.dailyWinPack, friendly.plan.bounty],
    ['win', B.sparks.loss, 0, 2, false, false, null], 'the streak stays where it was, neither grown nor broken')
  assert.deepEqual(answer.xp.map(x => x.xp), [B.xp.win], 'the cards still learn from it')
  const lost = fight('duel', 'loss', { counts: false })
  assert.deepEqual([lost.plan.answer.sparks, lost.plan.answer.streak], [B.sparks.loss, 2])
  assert.equal(fight('wild', 'win', { counts: true }).plan.answer.sparks, B.sparks.win, 'counts is for duels; omitted, it is true')
})

// Offline battles (SPEC 5, 13, 17-19, 22, 24, 28): spacing, wild teams and Rivals, settling by the core rules, the
// catch, raised forms, tiredness, streaks, abandoned battles and one-shot finishes and catches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BattleCard, Family } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, eloDelta, perfectRounds, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY, finishAfter, leagueOf } from '../../plugin/hooks/core/economy.ts'
import { typeMult } from '../../plugin/hooks/core/families.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { DAY_MS, EPOCH_MS } from '../../plugin/hooks/core/world.ts'
import { createLocalBackend } from '../../plugin/hooks/client/local/index.ts'
import type { LocalState } from '../../plugin/hooks/client/local/save.ts'
import { encodeState, openSave } from '../../plugin/hooks/client/local/save.ts'
import { BackendError } from '../../plugin/hooks/client/types.ts'

const NOW = EPOCH_MS + 3 * DAY_MS + 3_600_000
const B = ECONOMY.battle
const MIN = 60_000

function world(o: { family?: Family; seed?: string } = {}) {
  const w = { stored: undefined as unknown, now: NOW, saves: 0 }
  const backend = createLocalBackend({
    load: async () => (w.stored === undefined ? undefined : JSON.parse(JSON.stringify(w.stored))),
    save: async v => { w.saves++; w.stored = JSON.parse(JSON.stringify(v)) },
    now: async () => w.now,
    random: rngFromSeed(o.seed ?? 'battles'),
    family: () => o.family ?? 'opus',
  })
  /** Changes the save directly, as another version of the game might have left it. */
  const edit = (fn: (s: LocalState) => void) => {
    const opened = openSave(w.stored)
    assert.equal(opened.kind, 'ok')
    if (opened.kind !== 'ok') return
    fn(opened.state)
    w.stored = JSON.parse(JSON.stringify(encodeState(opened.state, 'edited')))
  }
  const state = (): LocalState => { const o2 = openSave(w.stored); if (o2.kind !== 'ok') throw new Error('no save'); return o2.state }
  return Object.assign(w, { backend, edit, state })
}

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e)
  assert.ok(err instanceof BackendError, `expected ${code}, got ${String(err)}`)
  assert.equal(err.code, code, err.message)
}

const weak = (c: BattleCard): BattleCard => ({ ...c, stats: { hp: 1, atk: 1, def: 1, spd: 1 } })
const mighty = (c: BattleCard): BattleCard => ({ ...c, stats: { hp: 9000, atk: 900, def: 900, spd: 900 } })

/** Starts a battle and fixes its outcome by making one side's snapshot harmless. */
async function battle(w: ReturnType<typeof world>, kind: 'wild' | 'duel', outcome: 'win' | 'loss', family: Family = 'haiku') {
  const start = await w.backend.startBattle({ kind, family })
  w.edit(s => {
    if (s.battle?.state !== 'open') return
    const setup = s.battle.setup
    if (outcome === 'win') { setup.defender = setup.defender.map(weak); setup.attacker = setup.attacker.map(mighty) }
    else { setup.attacker = setup.attacker.map(weak); setup.defender = setup.defender.map(mighty) }
  })
  w.now = start.finishAfter
  const done = await w.backend.finishBattle({ battleId: start.id, inputs: [] })
  assert.equal(done.result, outcome)
  return { start, done }
}

test('a wild battle: pacing from the server rules, a wild opponent, the rules version, no first-in-the-world', async () => {
  const w = world()
  await w.backend.me({})
  const start = await w.backend.startBattle({ kind: 'wild', family: 'haiku' })
  assert.deepEqual(start.opponent, { kind: 'wild' })
  assert.deepEqual([start.setup.kind, start.setup.arena, start.setup.rules, start.startedAt], ['wild', 'haiku', RULES_VERSION, NOW])
  assert.ok(start.setup.defender.length >= 1 && start.setup.defender.length <= 3)
  assert.deepEqual(start.firstPossible, start.setup.defender.map(() => false))
  assert.equal(start.finishAfter, finishAfter(NOW, simulateBattle(start.setup, []).rounds.length))
  const me = await w.backend.me({})
  assert.equal(me.player.nextWildAt, NOW + B.wildSpacingMs)
  assert.equal(me.player.rested, false)
  // the same spacing as online: a second wild start waits, a duel does not
  await refused(w.backend.startBattle({ kind: 'wild', family: 'haiku' }), 'rate_limited')
  const duel = await w.backend.startBattle({ kind: 'duel', family: 'haiku' })
  assert.equal(duel.opponent.kind, 'rival')
  await refused(w.backend.finishBattle({ battleId: start.id, inputs: [] }), 'conflict')
  await refused(w.backend.startBattle({ kind: 'duel', family: 'haiku' }), 'rate_limited')
  await refused(w.backend.startBattle({ kind: 'duel', family: 'haiku', revenge: 'soft-otter-42' }), 'not_allowed')
})

test('the first wild win always catches; the catch is the creature itself, once; everything pays', async () => {
  const w = world()
  const before = await w.backend.me({})
  const { start, done } = await battle(w, 'wild', 'win')
  assert.equal(done.catchOptions.length, start.setup.defender.length)
  assert.deepEqual([done.sparks, done.streak, done.streakPack, done.dailyWinPack, done.rating, done.ratingDelta], [B.sparks.win, 1, false, true, 1000, 0])
  assert.deepEqual(done.log, simulateBattle({ ...start.setup, attacker: start.setup.attacker.map(mighty), defender: start.setup.defender.map(weak) }, []))
  // the starters took part: one won battle is enough to evolve them, raised in the arena they fought in
  assert.equal(done.xp.length >= 1, true)
  const cards = (await w.backend.cards({})).cards
  for (const x of done.xp) {
    const c = cards.find(k => k.id === x.cardId)!
    assert.deepEqual([x.xp, x.levelsGained, x.evolved, x.stage, c.level, c.stage], [B.xp.win, 1, true, 2, 4, 2])
    assert.equal(c.raisedIn, 'haiku', 'raised in the only arena it fought in')
  }
  const me = await w.backend.me({})
  assert.equal(me.player.sparks, before.player.sparks + B.sparks.win)
  assert.equal(me.player.battles, 1)
  assert.equal(me.packs.filter(p => p.source === 'daily').length, 1)

  const option = done.catchOptions[1] ?? done.catchOptions[0]!
  const { card } = await w.backend.catchCreature({ battleId: start.id, index: done.catchOptions.indexOf(option) })
  assert.deepEqual([card.species, card.dna, card.genes, card.traits, card.level, card.origin, card.bound], [option.species, option.dna, option.genes, option.traits, option.level, 'catch', false])
  assert.ok((await w.backend.cards({})).cards.some(c => c.id === card.id))
  await refused(w.backend.catchCreature({ battleId: start.id, index: 0 }), 'conflict')
  await refused(w.backend.finishBattle({ battleId: start.id, inputs: [] }), 'conflict')
  await refused(w.backend.catchCreature({ battleId: 'someother', index: 0 }), 'not_found')

  // the daily first win pays once a day
  w.now += B.wildSpacingMs
  const second = await battle(w, 'wild', 'win')
  assert.equal(second.done.dailyWinPack, false)
})

test('beginner\'s luck: the first wild encounter is one level-1 common the lead beats, then wild teams are ordinary', async () => {
  const w = world({ family: 'sonnet' })
  await w.backend.me({})
  const s0 = w.state()
  const lead = s0.cards.find(c => c.id === s0.team[0])!
  const wild = ECONOMY.wild as { mythicChance: number }
  const saved = wild.mythicChance
  wild.mythicChance = 1
  try {
    const { start, done } = await battle(w, 'wild', 'win', 'opus')
    const [c, ...more] = start.setup.defender
    assert.deepEqual([more, c!.rarity, c!.level], [[], 'common', 1])
    assert.ok(typeMult(lead.family, c!.family, start.setup.rule) > 1 && typeMult(c!.family, lead.family, start.setup.rule) < 1)
    assert.deepEqual(done.catchOptions.map(x => [x.id, x.species, x.dna]), [[c!.id, c!.species, c!.dna]])
    w.now += B.wildSpacingMs
    assert.equal((await w.backend.startBattle({ kind: 'wild', family: 'opus' })).setup.defender[0]!.species, 'mythic')
  } finally {
    wild.mythicChance = saved
  }
})

test('a catch offers only the creatures a win defeated: a round-limit win defeats none, and beginner\'s luck waits', async () => {
  const w = world()
  await w.backend.me({})
  const start = await w.backend.startBattle({ kind: 'wild', family: 'haiku' })
  // chips against 999 HP: the attacker wins on the HP fraction at round 20 and nobody faints; the wild side is a
  // plain haiku, so no heal (Couplet, Regrowth) can top it back up
  w.edit(s => {
    if (s.battle?.state !== 'open') return
    s.battle.setup.attacker = s.battle.setup.attacker.map(c => ({ ...c, stats: { hp: 999, atk: 50, def: 999, spd: 999 } }))
    s.battle.setup.defender = s.battle.setup.defender.map(c => ({
      ...c, species: 's1-haiku-0', family: 'haiku' as const, traits: ['swift' as const], stats: { hp: 999, atk: 1, def: 999, spd: 1 },
    }))
  })
  w.now = start.finishAfter
  const done = await w.backend.finishBattle({ battleId: start.id, inputs: [] })
  assert.deepEqual([done.result, done.log.fainted.d, done.catchOptions, w.state().wildWon], ['win', [], [], false])

  w.now += B.wildSpacingMs
  const next = await battle(w, 'wild', 'win')
  assert.ok(next.done.catchOptions.length)
  assert.deepEqual(next.done.catchOptions.map(c => c.id), next.done.log.fainted.d.map(i => `wild-${i}`).sort())
  assert.equal(w.state().wildWon, true)
})

test('a win tires nobody, even a creature that fainted in it', async () => {
  const w = world()
  await w.backend.me({})
  const start = await w.backend.startBattle({ kind: 'wild', family: 'haiku' })
  w.edit(s => {
    if (s.battle?.state !== 'open') return
    const setup = s.battle.setup
    setup.attacker = setup.attacker.map((c, i) => (i === 0 ? weak(c) : mighty(c)))
    setup.defender = setup.defender.map(c => ({ ...c, traits: ['swift'], stats: { hp: 50, atk: 50, def: 1, spd: 50 } }))
  })
  w.now = start.finishAfter
  const done = await w.backend.finishBattle({ battleId: start.id, inputs: [] })
  assert.deepEqual([done.result, done.log.fainted.a, done.tired], ['win', [0], []])
  assert.ok(w.state().cards.every(c => c.tiredUntil === 0))
})

test('later wild wins catch by the catch roll; a catch window runs out after 10 minutes', async () => {
  let caught = 0
  const n = 60
  for (let i = 0; i < n; i++) {
    const w = world({ seed: `roll-${i}` })
    await w.backend.me({})
    await battle(w, 'wild', 'win')
    w.now += B.wildSpacingMs
    const { start, done } = await battle(w, 'wild', 'win')
    if (done.catchOptions.length) {
      caught++
      if (i % 4 === 0) {
        w.now += B.catchWindowMs
        await refused(w.backend.catchCreature({ battleId: start.id, index: 0 }), 'expired')
      }
    }
  }
  assert.ok(caught > n * 0.35 && caught < n * 0.95, `caught ${caught} of ${n}`)
})

test('a loss: fainted starters rest for 15 minutes and the bench steps in; the streak ends', async () => {
  const w = world()
  await w.backend.me({})
  await battle(w, 'wild', 'win')
  w.now += B.wildSpacingMs
  const pack = (await w.backend.me({})).packs[0]!
  await w.backend.openPack({ packId: pack.id })
  const { done } = await battle(w, 'wild', 'loss')
  assert.deepEqual([done.streak, done.sparks, done.catchOptions.length], [0, B.sparks.loss, 0])
  assert.ok(done.tired.length >= 1)
  const cards = (await w.backend.cards({})).cards
  for (const id of done.tired) assert.equal(cards.find(c => c.id === id)!.tiredUntil, w.now + B.tiredMs)
  w.now += B.duelSpacingMs
  const next = await w.backend.startBattle({ kind: 'duel', family: 'opus' })
  assert.equal(next.subs.length, done.tired.length)
  for (const sub of next.subs) {
    assert.ok(done.tired.includes(sub.replaced!))
    assert.ok(!done.tired.includes(sub.cardId))
  }
})

test('nothing to battle with: resting creatures say so', async () => {
  const w = world()
  await w.backend.me({})
  w.edit(s => { s.cards = s.cards.map(c => ({ ...c, tiredUntil: NOW + 5 * MIN })) })
  await refused(w.backend.startBattle({ kind: 'duel', family: 'opus' }), 'rate_limited')
  w.edit(s => { s.cards = []; s.team = [] })
  await refused(w.backend.startBattle({ kind: 'duel', family: 'opus' }), 'not_allowed')
})

test('Rival duels move the rating by Elo against the Rival\'s own rating; every 3rd win pays a streak pack', async () => {
  const w = world()
  await w.backend.me({})
  for (let i = 1; i <= 6; i++) {
    if (i > 1) w.now += B.duelSpacingMs
    const start = await w.backend.startBattle({ kind: 'duel', family: 'sonnet' })
    assert.equal(start.opponent.kind, 'rival')
    const rival = w.state().battle
    assert.ok(rival?.state === 'open' && rival.rival)
    if (start.opponent.kind === 'rival') assert.equal(start.opponent.league, leagueOf(rival.rival.rating).name)
    assert.ok(Math.abs(rival.rival.rating - w.state().rating) <= ECONOMY.rival.ratingSpread)
    const rating = w.state().rating
    w.edit(s => { if (s.battle?.state === 'open') s.battle.setup.defender = s.battle.setup.defender.map(weak) })
    w.now = start.finishAfter
    const done = await w.backend.finishBattle({ battleId: start.id, inputs: [] })
    assert.equal(done.result, 'win')
    assert.equal(done.ratingDelta, eloDelta(rating, rival.rival.rating, 'win').attacker)
    assert.equal(done.rating, rating + done.ratingDelta)
    assert.equal(done.sparks, B.sparks.duelWin)
    assert.deepEqual([done.streak, done.streakPack], [i, i % 3 === 0])
    assert.equal(done.catchOptions.length, 0)
  }
  const me = await w.backend.me({})
  assert.equal(me.packs.filter(p => p.source === 'streak').length, 2)
})

test('duel wins sometimes bring a bounty of the Rival lead\'s species', async () => {
  let bounties = 0
  for (let i = 0; i < 60; i++) {
    const w = world({ seed: `bounty-${i}` })
    await w.backend.me({})
    const { start, done } = await battle(w, 'duel', 'win')
    if (!done.bounty) continue
    bounties++
    assert.deepEqual([done.bounty.species, done.bounty.origin], [start.setup.defender[0]!.species, 'bounty'])
    assert.ok((await w.backend.cards({})).cards.some(c => c.id === done.bounty!.id))
  }
  assert.ok(bounties > 2 && bounties < 30, `${bounties} bounties`)
})

test('a press on the round the special fires is Perfect, as the core simulator decides', async () => {
  const w = world()
  await w.backend.me({})
  const start = await w.backend.startBattle({ kind: 'duel', family: 'opus' })
  const rounds = perfectRounds(simulateBattle(start.setup, []))
  w.now = start.finishAfter
  const done = await w.backend.finishBattle({ battleId: start.id, inputs: rounds.slice(0, 1) })
  assert.deepEqual(done.log, simulateBattle(start.setup, rounds.slice(0, 1)))
  if (rounds.length) assert.ok(done.log.rounds.some(r => r.actions.some(a => a.perfect)))
})

test('a battle left open 10 minutes settles with no presses and no catch; a new start settles the old one', async () => {
  const w = world()
  await w.backend.me({})
  const start = await w.backend.startBattle({ kind: 'wild', family: 'opus' })
  w.edit(s => { if (s.battle?.state === 'open') s.battle.setup.defender = s.battle.setup.defender.map(weak) })
  w.now += B.abandonMs
  const me = await w.backend.me({})
  assert.equal(me.player.battles, 1)
  assert.equal(me.player.streak, 1)
  // what nobody watched arrives as notices, as online
  assert.deepEqual(me.notices.map(n => n.kind).sort(), ['daily-pack', 'evolved'])
  assert.match(me.notices.find(n => n.kind === 'evolved')!.text, /^\S.* evolved into \S.*!$/)
  await refused(w.backend.finishBattle({ battleId: start.id, inputs: [] }), 'conflict')
  await refused(w.backend.catchCreature({ battleId: start.id, index: 0 }), 'conflict')
  assert.equal(w.state().wildWon, false, 'beginner\'s luck waits for a win someone watched')

  w.now += B.duelSpacingMs
  const a = await w.backend.startBattle({ kind: 'duel', family: 'opus' })
  w.edit(s => { if (s.battle?.state === 'open') s.battle.setup.defender = s.battle.setup.defender.map(weak) })
  w.now += B.duelSpacingMs
  await w.backend.startBattle({ kind: 'duel', family: 'opus' })
  assert.equal((await w.backend.me({})).player.battles, 2)
  await refused(w.backend.finishBattle({ battleId: a.id, inputs: [] }), 'conflict')
  await refused(w.backend.finishBattle({ battleId: 'neverwas', inputs: [] }), 'not_found')
})

test('raised forms: a card takes the arena it fought in most at its first evolution; a tie keeps it home', async () => {
  const raise = async (arenas: Family[], xp: number) => {
    const w = world({ family: 'opus' })
    await w.backend.me({})
    w.edit(s => { s.cards = s.cards.map(c => ({ ...c, xp })) })
    const lead = w.state().team[0]!
    for (const [i, arena] of arenas.entries()) {
      w.now += B.duelSpacingMs
      const { done } = await battle(w, 'duel', 'win', arena)
      assert.equal(done.xp[0]!.cardId, lead)
      const s = w.state()
      const card = s.cards.find(c => c.id === lead)!
      if (i < arenas.length - 1) {
        assert.deepEqual([card.stage, card.raisedIn], [1, undefined])
        assert.equal(s.arena[lead]![arena] > 0, true, 'counted while it has not evolved')
      } else {
        assert.equal(card.stage, 2)
        assert.equal(s.arena[lead], undefined, 'the counts go once the raising family is fixed')
        return card.raisedIn
      }
    }
  }
  assert.equal(await raise(['fable', 'fable', 'sonnet', 'fable'], 40), 'fable')
  assert.equal(await raise(['fable', 'sonnet'], 80), 'opus')
})

test('an offline Mythic is a local one: final form, foil, no finder\'s name', async () => {
  const w = world()
  await w.backend.me({})
  const { start } = await battle(w, 'wild', 'win')
  const mythic = toBattleCard({ ...generateMythic({ seed: 'localmythicseed', dna: 99, now: w.now, level: 4 }), id: 'wild-0' })
  w.edit(s => { if (s.battle?.state === 'settled') s.battle.options = [mythic] })
  const { card } = await w.backend.catchCreature({ battleId: start.id, index: 0 })
  assert.deepEqual([card.species, card.stage, card.foil, card.rarity, card.form?.kind], ['mythic', 3, true, 'legendary', 'mythic'])
  assert.equal(card.form?.discoveredBy, undefined)
  assert.ok(!(await w.backend.me({})).player.seen.includes('mythic'), 'a Mythic is not an album species')
})

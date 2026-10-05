import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BattleCard, BattleLog, BattleSetup, DailyRule, Family, TraitId } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, applyRating, battleRewards, eloDelta, participants, perfectRounds, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { cardStats, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO, typeMult } from '../../plugin/hooks/core/families.ts'
import { rollPack, rollWildTeam } from '../../plugin/hooks/core/packs.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { parseBattleSetup } from '../../plugin/hooks/core/schemas.ts'
import { atLevel, fighter, NOW } from './helpers.ts'

function setup(attacker: BattleCard[], defender: BattleCard[], over: Partial<BattleSetup> = {}): BattleSetup {
  return { seed: 'seed-1', kind: 'duel', arena: 'sonnet', rule: 'calm', rules: RULES_VERSION, attacker, defender, ...over }
}

/** A random but valid 3v3 duel. */
function randomDuel(i: number, rule: DailyRule = 'calm', level = 4): BattleSetup {
  const rng = rngFromSeed('duel-' + i)
  const fams: Family[] = ['haiku', 'sonnet', 'opus', 'fable']
  const team = (tag: string) => Array.from({ length: Math.ceil(3 / ECONOMY.packs.size) }, () => rollPack(fams[i % 4]!, 1, rng, NOW, 'calm'))
    .flat().slice(0, 3).map((c, j) => atLevel({ ...c, id: `${tag}${j}` }, level))
  return setup(team('a'), team('d'), { seed: 'duel-seed-' + i, arena: fams[(i + 1) % 4]!, rule })
}

function draws(seed: string, n: number): number[] {
  const r = rngFromSeed('battle/' + seed)
  return Array.from({ length: n }, r)
}

/** The damage formula of SPEC section 5, written independently of battle.ts, for a creature's first action. */
function expected(att: BattleCard, def: BattleCard, s: BattleSetup, d: [number, number], o: { move?: number; fresh?: boolean; alwaysSuper?: boolean; perfect?: boolean } = {}): number {
  const a = cardStats(att), b = cardStats(def)
  const atk = a.atk * (s.rule === 'opusDay' && att.family === 'opus' ? 1.15 : 1)
  const raw = (atk * atk) / (atk + b.def)
  let type = o.alwaysSuper ? 1.5 : typeMult(att.family, def.family, s.rule)
  if (type < 1 && att.traits.includes('stubborn')) type = 1
  const arena = att.family === s.arena ? (att.traits.includes('homebody') ? 1.2 : 1.1) : 1
  const variance = 0.85 + 0.15 * d[0]
  const crit = d[1] < (att.traits.includes('luckyStar') ? 1 / 8 : 1 / 16) ? (s.rule === 'glassDay' ? 2 : 1.5) : 1
  let mods = 1
  if (def.traits.includes('thickHide')) mods *= 0.9
  if ((o.fresh ?? true) && att.traits.includes('ambush')) mods *= 1.3
  if (o.move !== undefined && att.traits.includes('showoff')) mods *= 1.25
  const daily = s.rule === 'gentleDay' ? 0.85 : 1
  return Math.max(1, Math.round(raw * type * arena * variance * crit * (o.move ?? 1) * (o.perfect ? 1.3 : 1) * mods * daily))
}

const actions = (log: BattleLog) => log.rounds.flatMap(r => r.actions)

test('the same setup and inputs replay the same battle', () => {
  for (let i = 0; i < 20; i++) {
    const s = randomDuel(i)
    assert.deepEqual(simulateBattle(s, [3, 7]), simulateBattle(structuredClone(s), [3, 7]))
  }
})

test('a press at round r never changes any round before r, and only counts when the special fires', () => {
  let perfect = 0, ignored = 0
  for (let i = 0; i < 60; i++) {
    const s = randomDuel(i)
    const base = simulateBattle(s, [])
    const fires = new Set(perfectRounds(base))
    for (let r = 1; r <= base.rounds.length; r++) {
      const pressed = simulateBattle(s, [r])
      assert.deepEqual(pressed.rounds.slice(0, r - 1), base.rounds.slice(0, r - 1), `duel ${i} press ${r}`)
      const act = pressed.rounds[r - 1]!.actions.find(a => a.side === 'a')
      if (fires.has(r)) {
        assert.equal(act!.move, 'special')
        assert.equal(act!.perfect, true, `duel ${i}: a press on round ${r} makes the special Perfect`)
        perfect++
      } else {
        assert.deepEqual(pressed, base, `duel ${i}: a press on round ${r}, with no attacker special, is ignored`)
        ignored++
      }
    }
    // the band's [1] Now! flag announces every round where the attacker's special fires
    for (const r of fires) assert.ok(base.rounds[r - 2]?.attackerSpecialReady, `duel ${i}: round ${r} was announced`)
  }
  assert.ok(perfect > 50 && ignored > 50)
})

test('every action draws exactly variance then crit, in action order', () => {
  for (let i = 0; i < 30; i++) {
    const s = randomDuel(i)
    const log = simulateBattle(s, [])
    const n = actions(log).length
    const d = draws(s.seed, 2 * n)
    actions(log).forEach((a, k) => assert.equal(a.crit, d[2 * k + 1]! < (s[a.side === 'a' ? 'attacker' : 'defender'][a.slot]!.traits.includes('luckyStar') ? 1 / 8 : 1 / 16)))
    const first = log.rounds[0]!.actions[0]!
    const me = first.side === 'a' ? s.attacker[0]! : s.defender[0]!
    const foe = first.side === 'a' ? s.defender[0]! : s.attacker[0]!
    if (first.dmg < cardStats(foe).hp || !foe.traits.includes('sturdy')) {
      assert.equal(first.dmg, Math.min(expected(me, foe, s, [d[0]!, d[1]!]), cardStats(foe).hp), `duel ${i}`)
    }
  }
})

test('faster creature acts first; ties go to the attacker on odd rounds, the defender on even', () => {
  const twin = fighter('opus', { traits: ['regrowth'], level: 9 })
  const tie = simulateBattle(setup([twin], [{ ...twin, id: 'twin2' }]), [])
  tie.rounds.forEach(r => assert.equal(r.actions[0]!.side, r.round % 2 === 1 ? 'a' : 'd', `round ${r.round}`))
  const quick = simulateBattle(setup([{ ...twin, traits: ['swift'] }], [{ ...twin, id: 'slow' }]), [])
  quick.rounds.forEach(r => assert.equal(r.actions[0]!.side, 'a'))
  const slow = simulateBattle(setup([{ ...twin, traits: ['sleepy'] }], [{ ...twin, id: 'fast' }]), [])
  slow.rounds.forEach(r => assert.equal(r.actions[0]!.side, 'd'))
})

test('Haiku Day speeds up haiku creatures', () => {
  const o = fighter('sonnet', { traits: ['regrowth'], level: 5 })
  const so = cardStats(o).spd
  let h: BattleCard | undefined
  for (let g = 0; g < 16 && !h; g++) for (let level = 1; level <= 10 && !h; level++) {
    const c = fighter('haiku', { traits: ['regrowth'], level, genes: [8, 8, 8, g] })
    const sh = cardStats(c).spd
    if (sh < so && sh * 1.2 > so) h = c
  }
  assert.ok(h, 'fixture: a haiku slower than its foe only without the rule')
  assert.equal(simulateBattle(setup([h], [o]), []).rounds[0]!.actions[0]!.side, 'd')
  assert.equal(simulateBattle(setup([h], [o], { rule: 'haikuDay' }), []).rounds[0]!.actions[0]!.side, 'a')
})

test('both sides fire their special the moment it is charged; nobody holds', () => {
  const a = fighter('sonnet', { traits: ['thickHide', 'regrowth'], level: 10, genes: [15, 0, 15, 15], rarity: 'epic' as const, stage: 3 })
  const d = fighter('sonnet', { id: 'd', traits: ['thickHide', 'regrowth'], level: 10, genes: [15, 0, 15, 15], rarity: 'epic' as const, stage: 3 })
  const s = setup([a], [d])
  const log = simulateBattle(s, [])
  const moves = (side: 'a' | 'd') => log.rounds.map(r => r.actions.find(x => x.side === side)?.move)
  for (const side of ['a', 'd'] as const) assert.deepEqual(moves(side).slice(0, 6), ['attack', 'attack', 'special', 'attack', 'attack', 'special'], side)
  assert.deepEqual(log.rounds.slice(0, 3).map(r => r.attackerSpecialReady), [false, true, false])
  assert.deepEqual(log.rounds.slice(0, 3).map(r => r.charge.a[0]), [1, 2, 0])
  assert.deepEqual(perfectRounds(log).slice(0, 2), [3, 6])
  assert.deepEqual(simulateBattle(s, [1, 2, 4, 5]), log, 'presses off the special rounds do nothing')
  const pressed = simulateBattle(s, [3])
  assert.equal(pressed.rounds[2]!.actions.find(x => x.side === 'a')!.perfect, true)
  assert.equal(pressed.rounds[2]!.actions.find(x => x.side === 'd')!.perfect, undefined, 'only the attacker can be Perfect')
})

test('a Perfect special deals 1.3x', () => {
  const tough = { level: 10, genes: [15, 15, 15, 15] as [number, number, number, number], rarity: 'epic' as const, stage: 3 as const }
  for (const [family, mult] of [['opus', 2.1], ['sonnet', 1.5], ['fable', 1.6]] as const) {
    const att = fighter(family, { ...tough, traits: ['quickCharge', 'swift'] })
    const def = fighter('haiku', { ...tough, id: 'x', traits: ['regrowth', 'sleepy'] })
    const s = setup([att], [def], { arena: 'haiku' })
    for (const perfect of [false, true]) {
      const log = simulateBattle(s, perfect ? [2] : [])
      const sp = log.rounds[1]!.actions.find(x => x.side === 'a')!
      assert.equal(sp.move, 'special')
      assert.equal(sp.perfect, perfect ? true : undefined)
      const k = actions(log).indexOf(sp)
      const d = draws(s.seed, 2 * (k + 1))
      const opts = { move: mult, fresh: false, perfect, alwaysSuper: family === 'fable' }
      assert.equal(sp.dmg, expected(att, def, s, [d[2 * k]!, d[2 * k + 1]!], opts), `${family} perfect=${perfect}`)
    }
  }
})

test('cards carrying server stats battle with those stats', () => {
  const a = fighter('opus', { traits: ['regrowth'], level: 6 })
  const d = fighter('haiku', { id: 'd', traits: ['regrowth'], level: 6 })
  const plain = simulateBattle(setup([a], [d]), [])
  assert.deepEqual(simulateBattle(setup([{ ...a, stats: cardStats(a) }], [{ ...d, stats: cardStats(d) }]), []), plain)
  const buffed = simulateBattle(setup([{ ...a, stats: { ...cardStats(a), hp: 999 } }], [d]), [])
  assert.equal(buffed.maxHp.a[0], 999)
  assert.notDeepEqual(buffed, plain)
})

test('balance: a player who never presses wins about half of even duels; Perfect timing helps', () => {
  const all = Array.from({ length: 30 }, (_, k) => k + 1)
  let none = 0, perfect = 0
  const n = 1500
  for (let i = 0; i < n; i++) {
    const s = randomDuel(i, 'calm', 1 + (i % 10))
    const mirror = { ...s, defender: s.attacker.map(c => ({ ...c, id: 'd' + c.id })) }
    if (simulateBattle(mirror, []).result === 'win') none++
    if (simulateBattle(mirror, all).result === 'win') perfect++
  }
  assert.ok(none / n > 0.45 && none / n < 0.58, `no input wins ${none / n}`)
  assert.ok(perfect / n > none / n + 0.1, `perfect wins ${perfect / n}`)
})

test('Quick Charge and Fable Day make specials ready after one attack', () => {
  const base = { traits: ['thickHide', 'regrowth'] as TraitId[], level: 10, genes: [15, 0, 15, 15] as [number, number, number, number], rarity: 'epic' as const, stage: 3 as const }
  const qc = simulateBattle(setup([fighter('sonnet', base)], [fighter('sonnet', { ...base, id: 'q', traits: ['quickCharge', 'regrowth'] })]), [])
  assert.deepEqual(qc.rounds.slice(0, 4).map(r => r.actions.find(x => x.side === 'd')!.move), ['attack', 'special', 'attack', 'special'])
  const fab = simulateBattle(setup([fighter('sonnet', base)], [fighter('fable', { ...base, id: 'f' })], { rule: 'fableDay' }), [])
  assert.deepEqual(fab.rounds.slice(0, 2).map(r => r.actions.find(x => x.side === 'd')!.move), ['attack', 'special'])
  const notFable = simulateBattle(setup([fighter('sonnet', base)], [fighter('opus', { ...base, id: 'o' })], { rule: 'fableDay' }), [])
  assert.equal(notFable.rounds[1]!.actions.find(x => x.side === 'd')!.move, 'attack')
})

test('the four specials and Mimic', () => {
  const tough = { level: 10, genes: [15, 15, 15, 15] as [number, number, number, number], rarity: 'epic' as const, stage: 3 as const }
  const target = (family: Family) => fighter(family, { ...tough, id: 't', traits: ['regrowth', 'sturdy'] })
  const specialOf = (family: Family, traits: TraitId[], against: Family, rule: DailyRule = 'calm') => {
    const s = setup([target(against)], [fighter(family, { ...tough, id: 's', traits })], { rule, arena: 'haiku' })
    const log = simulateBattle(s, [])
    return { s, log, act: actions(log).find(x => x.side === 'd' && x.move === 'special')! }
  }
  const fl = specialOf('haiku', ['regrowth', 'thickHide'], 'haiku')
  assert.equal(fl.act.special, 'flurry')
  assert.equal(fl.act.hits, 2)
  assert.equal(fl.act.dmg % 2, 0)
  const cp = specialOf('sonnet', ['regrowth', 'thickHide'], 'sonnet')
  assert.equal(cp.act.special, 'couplet')
  const max = cardStats(cp.s.defender[0]!).hp
  const before = cp.log.rounds[cp.act.round - 2]!.hp.d[0]!
  const hitBack = cp.log.rounds[cp.act.round - 1]!.actions.filter(x => x.side === 'a').reduce((n, x) => n + x.dmg, 0)
  assert.equal(cp.act.heal, Math.min(Math.round(max * 0.15), max - before + (cp.log.rounds[cp.act.round - 1]!.actions[0]!.side === 'a' ? hitBack : 0)))
  const cr = specialOf('opus', ['regrowth', 'thickHide'], 'opus')
  assert.equal(cr.act.special, 'crescendo')
  const tw = specialOf('fable', ['regrowth', 'thickHide'], 'haiku')
  assert.equal(tw.act.special, 'twist')
  assert.equal(tw.act.effect, 'super', 'haiku beats fable, but Twist always lands super effective')
  const mi = specialOf('fable', ['mimic', 'regrowth'], 'opus')
  assert.equal(mi.act.special, FAMILY_INFO.opus.special)
  assert.ok(mi.act.traits.includes('mimic'))
})

test('special damage uses the move multiplier (first action, fresh)', () => {
  const tough = { level: 10, genes: [15, 15, 15, 15] as [number, number, number, number], rarity: 'epic' as const, stage: 3 as const }
  for (const [family, mult] of [['opus', 2.1], ['sonnet', 1.5]] as const) {
    const att = fighter(family, { ...tough, traits: ['quickCharge', 'swift'] })
    const def = fighter('fable', { ...tough, id: 'x', traits: ['regrowth', 'sleepy'] })
    const s = setup([att], [def], { arena: 'haiku' })
    const log = simulateBattle(s, [])
    const sp = log.rounds[1]!.actions.find(x => x.side === 'a')!
    assert.equal(sp.move, 'special')
    const k = actions(log).indexOf(sp)
    const d = draws(s.seed, 2 * (k + 1))
    assert.equal(sp.dmg, expected(att, def, s, [d[2 * k]!, d[2 * k + 1]!], { move: mult, fresh: false }))
  }
})

test('trait effects on the first hit: Ambush, Thick Hide, Homebody, Stubborn, Showoff, Opus Day, Gentle Day', () => {
  const cases: [string, Partial<BattleCard>, Partial<BattleCard>, Partial<BattleSetup>, TraitId | null][] = [
    ['ambush', { traits: ['ambush'] }, {}, {}, 'ambush'],
    ['thick hide', {}, { traits: ['thickHide'] }, {}, 'thickHide'],
    ['homebody', { family: 'sonnet', traits: ['homebody'] }, {}, { arena: 'sonnet' }, 'homebody'],
    ['stubborn', { family: 'sonnet', traits: ['stubborn'] }, { family: 'opus' }, {}, 'stubborn'],
    ['opus day', { family: 'opus' }, {}, { rule: 'opusDay' }, null],
    ['gentle day', {}, {}, { rule: 'gentleDay' }, null],
    ['topsy-turvy', { family: 'sonnet' }, { family: 'opus' }, { rule: 'topsyTurvy' }, null],
  ]
  for (const [name, a, d, over, fired] of cases) {
    const att = fighter((a.family ?? 'haiku') as Family, { level: 8, traits: ['swift'], ...a, ...(a.traits ? { traits: [...a.traits, 'swift'] as TraitId[] } : {}) })
    const def = fighter((d.family ?? 'fable') as Family, { id: 'd', level: 3, traits: ['sleepy'], ...d, ...(d.traits ? { traits: [...d.traits, 'sleepy'] as TraitId[] } : {}) })
    const s = setup([att], [def], over)
    const first = simulateBattle(s, []).rounds[0]!.actions[0]!
    assert.equal(first.side, 'a', name)
    const dr = draws(s.seed, 2)
    assert.equal(first.dmg, Math.min(expected(att, def, s, [dr[0]!, dr[1]!]), cardStats(def).hp), name)
    if (fired) assert.ok(first.traits.includes(fired), `${name} fired`)
    if (name === 'stubborn') assert.equal(first.effect, 'normal')
    if (name === 'topsy-turvy') assert.equal(first.effect, 'super')
  }
})

test('Ambush only boosts the first action', () => {
  const att = fighter('haiku', { traits: ['ambush', 'swift'], level: 6 })
  const def = fighter('fable', { id: 'd', traits: ['regrowth', 'sleepy'], level: 9, rarity: 'epic' as const })
  const log = simulateBattle(setup([att], [def]), [])
  const mine = actions(log).filter(a => a.side === 'a')
  assert.ok(mine[0]!.traits.includes('ambush'))
  for (const a of mine.slice(1)) assert.ok(!a.traits.includes('ambush'))
})

test('Lucky Star doubles crit chance; Glass Day crits hit for 2x', () => {
  let crits = 0, total = 0, luckyCrits = 0, luckyTotal = 0
  for (let i = 0; i < 400; i++) {
    const s = randomDuel(i)
    const lucky = { ...s, attacker: s.attacker.map(c => ({ ...c, traits: c.traits.length === 2 ? ['luckyStar', c.traits.find(t => t !== 'luckyStar')!] as TraitId[] : ['luckyStar'] as TraitId[] })) }
    for (const a of actions(simulateBattle(s, []))) if (a.side === 'a' && !s.attacker[a.slot]!.traits.includes('luckyStar')) { total++; if (a.crit) crits++ }
    for (const a of actions(simulateBattle(lucky, []))) if (a.side === 'a') { luckyTotal++; if (a.crit) luckyCrits++ }
  }
  assert.ok(Math.abs(crits / total - 1 / 16) < 0.012, `crit ${crits / total}`)
  assert.ok(Math.abs(luckyCrits / luckyTotal - 1 / 8) < 0.015, `lucky ${luckyCrits / luckyTotal}`)
  // Glass Day: find a crit on a first hit and compare with the formula
  for (let i = 0; i < 500; i++) {
    const att = fighter('haiku', { traits: ['luckyStar', 'swift'], level: 4 })
    const def = fighter('fable', { id: 'd', traits: ['regrowth', 'sleepy'], level: 9, rarity: 'epic' as const })
    const s = setup([att], [def], { rule: 'glassDay', seed: 'glass-' + i })
    const first = simulateBattle(s, []).rounds[0]!.actions[0]!
    if (!first.crit) continue
    const dr = draws(s.seed, 2)
    const [me, foe] = first.side === 'a' ? [att, def] : [def, att]
    assert.equal(first.dmg, Math.min(expected(me, foe, s, [dr[0]!, dr[1]!]), cardStats(foe).hp))
    assert.ok(first.dmg > Math.round(expected(me, foe, { ...s, rule: 'calm' }, [dr[0]!, dr[1]!]) * 1.2) || first.dmg === cardStats(foe).hp)
    return
  }
  assert.fail('no crit found')
})

test('Sturdy survives the first lethal hit with 1 HP, once', () => {
  const big = fighter('opus', { traits: ['swift', 'glassHeart'], level: 10, rarity: 'epic' as const, stage: 3, genes: [15, 15, 15, 15] })
  const tiny = fighter('sonnet', { id: 't', traits: ['sturdy'], level: 1, genes: [0, 0, 0, 0] })
  const log = simulateBattle(setup([{ ...big, traits: ['swift', 'glassHeart'] }], [tiny], { arena: 'opus' }), [])
  const hits = actions(log).filter(a => a.side === 'a')
  assert.ok(hits[0]!.traits.includes('sturdy'))
  assert.equal(log.rounds[0]!.hp.d[0], 1)
  assert.equal(hits[0]!.targetFainted, false)
  const later = hits.slice(1).find(a => a.targetFainted)!
  assert.ok(later, 'the second lethal hit lands')
  assert.ok(!later.traits.includes('sturdy'))
  assert.equal(log.result, 'win')
})

test('Flurry against Sturdy: the second hit finishes the job', () => {
  for (let level = 1; level <= 10; level++) for (let i = 0; i < 30; i++) {
    const big = fighter('haiku', { traits: ['quickCharge', 'swift'], level: 10, rarity: 'epic' as const, stage: 3, genes: [15, 15, 15, 15] })
    const tiny = fighter('fable', { id: 't', traits: ['sturdy'], level, genes: [15, 0, 0, 0] })
    const log = simulateBattle(setup([big], [tiny], { seed: `fl-${level}-${i}`, arena: 'haiku' }), [])
    const sp = actions(log).find(a => a.move === 'special' && a.side === 'a')
    if (!sp || !sp.traits.includes('sturdy')) continue
    assert.equal(sp.hits, 2)
    assert.equal(sp.targetFainted, true)
    return
  }
  assert.fail('no flurry vs sturdy case found')
})

test('Regrowth and Sonnet Day heal at the end of each round', () => {
  const att = fighter('haiku', { traits: ['swift'], level: 3 })
  const healer = fighter('opus', { id: 'h', traits: ['regrowth'], level: 7, rarity: 'rare' as const })
  const log = simulateBattle(setup([att], [healer], { arena: 'fable' }), [])
  const max = cardStats(healer).hp
  const taken = log.rounds[0]!.actions.filter(a => a.side === 'a').reduce((n, a) => n + a.dmg, 0)
  assert.equal(log.rounds[0]!.hp.d[0], Math.min(max, max - taken + Math.max(1, Math.round(max * 0.06))))
  const son = fighter('sonnet', { id: 's', traits: ['thickHide'], level: 7 })
  const day = simulateBattle(setup([att], [son], { rule: 'sonnetDay', arena: 'fable' }), [])
  const smax = cardStats(son).hp
  const staken = day.rounds[0]!.actions.filter(a => a.side === 'a').reduce((n, a) => n + a.dmg, 0)
  assert.equal(day.rounds[0]!.hp.d[0], Math.min(smax, smax - staken + Math.max(1, Math.round(smax * 0.04))))
})

test('Underdog, Moonlit and Showoff fire when they should', () => {
  let under = false, moon = false, show = false
  for (let i = 0; i < 80 && !(under && moon && show); i++) {
    const s = randomDuel(i, 'calm', 6)
    s.defender = s.defender.map(c => ({ ...c, traits: c.traits.length === 2 ? ['underdog', 'moonlit'] : ['underdog'] }))
    s.attacker = s.attacker.map(c => ({ ...c, traits: c.traits.length === 2 ? ['showoff', 'moonlit'] : ['showoff'] }))
    const log = simulateBattle(s, [])
    let hp = { a: [...log.maxHp.a], d: [...log.maxHp.d] }
    for (const r of log.rounds) {
      for (const a of r.actions) {
        const me = a.side === 'a' ? s.attacker[a.slot]! : s.defender[a.slot]!
        const myHp = hp[a.side][a.slot]!
        if (me.traits.includes('underdog') && a.traits.includes('underdog')) { under = true; assert.ok(myHp < 0.3 * log.maxHp[a.side][a.slot]!) }
        if (a.move === 'special' && me.traits.includes('moonlit')) {
          assert.ok(a.traits.includes('moonlit'))
          if (a.heal > 0) moon = true
        }
        if (me.traits.includes('showoff')) {
          assert.equal(a.traits.includes('showoff'), a.move === 'special')
          if (a.move === 'special') show = true
        }
        const foe = a.side === 'a' ? 'd' : 'a'
        hp[foe][a.targetSlot] = Math.max(0, hp[foe][a.targetSlot]! - a.dmg)
        hp[a.side][a.slot] = myHp + a.heal
      }
      hp = { a: [...r.hp.a], d: [...r.hp.d] }
    }
  }
  assert.ok(under && moon && show, JSON.stringify({ under, moon, show }))
})

test('Guardian toughens the next ally after it faints', () => {
  const att = fighter('opus', { traits: ['swift', 'glassHeart'], level: 10, rarity: 'epic' as const, stage: 3 })
  const next = fighter('haiku', { id: 'n', traits: ['regrowth', 'sleepy'], level: 9, rarity: 'epic' as const, stage: 3, genes: [15, 15, 15, 15] })
  let lower = 0
  for (let i = 0; i < 40; i++) {
    const guard = fighter('sonnet', { id: 'g', traits: ['guardian'], level: 1 })
    const plain = { ...guard, traits: ['homebody'] as TraitId[] }
    const a = simulateBattle(setup([att], [guard, next], { seed: 'g' + i, arena: 'fable' }), [])
    const b = simulateBattle(setup([att], [plain, next], { seed: 'g' + i, arena: 'fable' }), [])
    const ko = actions(a).find(x => x.targetFainted)!
    assert.ok(ko.traits.includes('guardian'))
    const hitA = actions(a).find(x => x.side === 'a' && x.targetSlot === 1)
    const hitB = actions(b).find(x => x.side === 'a' && x.targetSlot === 1)
    if (!hitA || !hitB || hitA.crit !== hitB.crit || hitA.round !== hitB.round) continue
    assert.ok(hitA.dmg <= hitB.dmg)
    if (hitA.dmg < hitB.dmg) lower++
  }
  assert.ok(lower > 10)
})

test('20-round limit, 30 on Long Day, tiebreak by remaining HP fraction', () => {
  let found = 0
  for (let i = 0; i < 3000 && found < 5; i++) {
    const s = randomDuel(i, 'calm', 6)
    const log = simulateBattle(s, [])
    assert.ok(log.rounds.length <= 20)
    const last = log.rounds[log.rounds.length - 1]!
    if (log.rounds.length < 20 || last.active.a < 0 || last.active.d < 0) continue
    found++
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    const fa = sum(last.hp.a) / sum(log.maxHp.a), fd = sum(last.hp.d) / sum(log.maxHp.d)
    assert.equal(log.result, fa > fd ? 'win' : fa < fd ? 'loss' : 'draw')
    const long = simulateBattle({ ...s, rule: 'longDay' }, [])
    assert.deepEqual(long.rounds.slice(0, 20), log.rounds)
    assert.ok(long.rounds.length > 20 && long.rounds.length <= 30)
  }
  assert.ok(found >= 3, `found ${found} long battles`)
})

test('results, fainted lists, active slots and participants', () => {
  for (let i = 0; i < 40; i++) {
    const s = randomDuel(i)
    const log = simulateBattle(s, [])
    const last = log.rounds[log.rounds.length - 1]!
    if (log.result === 'win' && last.active.d === -1) assert.deepEqual([...log.fainted.d].sort(), [0, 1, 2])
    if (log.result === 'loss' && last.active.a === -1) assert.deepEqual([...log.fainted.a].sort(), [0, 1, 2])
    for (const r of log.rounds) for (const side of ['a', 'd'] as const) {
      assert.equal(r.hp[side].length, 3)
      for (const [slot, hp] of r.hp[side].entries()) assert.ok(hp >= 0 && hp <= log.maxHp[side][slot]!)
    }
    const p = participants(log, 'a')
    assert.deepEqual(p, Array.from({ length: p.length }, (_, k) => k))
    assert.ok(p.length >= log.fainted.a.length)
  }
  const wild = rollWildTeam({ rng: rngFromSeed('w'), arena: 'haiku', now: NOW, level: 1 })
  const strong = [fighter('haiku', { level: 10, rarity: 'epic' as const, stage: 3, traits: ['swift', 'glassHeart'] })]
  const w = simulateBattle(setup(strong, wild, { kind: 'wild' }), [])
  assert.equal(w.result, 'win')
  assert.deepEqual(participants(w, 'a'), [0])
  assert.doesNotThrow(() => parseBattleSetup(setup(strong.map(toBattleCard), wild, { kind: 'wild' })))
  assert.equal(simulateBattle(setup([], []), []).result, 'draw')
})

test('Elo: round(32 * (S - E)), defender moves -round(delta / 2), floor 0', () => {
  assert.deepEqual(eloDelta(1000, 1000, 'win'), { attacker: 16, defender: -8 })
  assert.deepEqual(eloDelta(1000, 1000, 'loss'), { attacker: -16, defender: 8 })
  assert.deepEqual(eloDelta(1000, 1000, 'draw'), { attacker: 0, defender: -0 })
  const up = eloDelta(1000, 1400, 'win')
  assert.equal(up.attacker, Math.round(32 * (1 - 1 / (1 + 10 ** (400 / 400)))))
  assert.equal(up.attacker, 29)
  assert.equal(up.defender, -Math.round(29 / 2))
  assert.equal(eloDelta(1400, 1000, 'win').attacker, 3)
  assert.equal(applyRating(10, -16), 0)
  assert.equal(applyRating(1000, 16), 1016)
})

test("battle rewards by result and kind: every battle pays; revenge and beginner's luck", () => {
  assert.deepEqual(battleRewards('wild', 'win', 'calm'), { sparks: 10, xp: 20, catchChance: 0.6, bountyChance: 0 })
  assert.deepEqual(battleRewards('duel', 'win', 'calm'), { sparks: 12, xp: 20, catchChance: 0, bountyChance: 0.2 })
  assert.deepEqual(battleRewards('duel', 'draw', 'calm'), { sparks: 5, xp: 12, catchChance: 0, bountyChance: 0 })
  assert.deepEqual(battleRewards('wild', 'loss', 'calm'), { sparks: 3, xp: 8, catchChance: 0, bountyChance: 0 })
  assert.deepEqual(battleRewards('wild', 'win', 'wildBloom'), { sparks: 10, xp: 20, catchChance: 0.8, bountyChance: 0 })
  assert.equal(battleRewards('wild', 'win', 'calm', { firstWildWin: true }).catchChance, 1)
  assert.equal(battleRewards('wild', 'loss', 'calm', { firstWildWin: true }).catchChance, 0)
  assert.equal(battleRewards('duel', 'win', 'calm', { revenge: true }).sparks, 17)
  assert.equal(battleRewards('duel', 'loss', 'calm', { revenge: true }).sparks, 3)
  assert.deepEqual(battleRewards('duel', 'win', 'calm', { rival: true }), { sparks: 12, xp: 20, catchChance: 0, bountyChance: 0 }, 'a Rival pays no bounty')
})

test('every round plays at one pace, comfortably above the finish minimum', () => {
  assert.equal(ECONOMY.battle.roundMs, 2200)
  assert.ok(ECONOMY.battle.roundMs > ECONOMY.battle.minRoundMs, 'a live battle never waits on the server')
})

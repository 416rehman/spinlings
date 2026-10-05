import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rarity } from '../../plugin/hooks/core/types.ts'
import { otherFamily, rollBounty, rollFirstWild, rollPack, rollWildTeam } from '../../plugin/hooks/core/packs.ts'
import { int, pick, rngFromSeed, shuffle } from '../../plugin/hooks/core/rng.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { FAMILIES, beatenBy, beats, typeMult } from '../../plugin/hooks/core/families.ts'
import { getSpecies, legendaryOf } from '../../plugin/hooks/core/species.ts'
import { mythicForm } from '../../plugin/hooks/core/mythics.ts'
import { DAY_MS, EPOCH_MS, dailyRule, featuredSpecies, seasonOf, weeklyRoamer } from '../../plugin/hooks/core/world.ts'
import { parseBattleCard, parseCard } from '../../plugin/hooks/core/schemas.ts'
import { recycleValue, stageFor, starterTeam, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { fighter, NOW, near } from './helpers.ts'

test('a pack is exactly 1 fresh card of its family and season', () => {
  const cards = rollPack('fable', 1, rngFromSeed('p'), NOW, 'calm')
  assert.equal(cards.length, 1)
  for (const c of cards) {
    assert.equal(c.family, 'fable')
    assert.equal(c.season, 1)
    assert.equal(c.origin, 'pack')
    assert.equal(c.level, 1)
    assert.doesNotThrow(() => parseCard({ ...c, id: 'x' }))
  }
  assert.deepEqual(rollPack('fable', 1, rngFromSeed('p'), NOW, 'calm'), cards)
})

test('pack odds are 70/22/7/1 with no rarity guarantee; a legendary is the family legendary', () => {
  const rng = rngFromSeed('odds')
  const early: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  let shiny = 0
  const packs = 12_000
  for (let i = 0; i < packs; i++) {
    const cards = rollPack('haiku', 2, rng, NOW, 'calm')
    assert.equal(cards.length, 1)
    cards.forEach(c => {
      early[c.rarity]++
      if (c.shiny) shiny++
      const s = getSpecies(c.species)!
      assert.equal(s.legendary, c.rarity === 'legendary')
      if (c.rarity === 'legendary') assert.equal(s.id, legendaryOf(2, 'haiku').id)
    })
  }
  const n = packs
  assert.ok(near(early.common, n, 0.7) && near(early.rare, n, 0.22) && near(early.epic, n, 0.07) && near(early.legendary, n, 0.01), JSON.stringify(early))
  assert.ok(near(shiny, packs, 0.01), `shiny ${shiny}`)
})

test('a bought pack recycles for well under its price, even in Shiny Hour: buying is never a sparks pump', () => {
  // Shiny Hour is the only daily rule that changes what a pack holds
  const shinyHour = NOW - (NOW % DAY_MS) + 18.5 * 3_600_000
  for (const [rule, now] of [['calm', NOW], ['shinyHour', shinyHour]] as const) {
    const rng = rngFromSeed('pump-' + rule)
    const packs = 20_000
    let sparks = 0
    for (let i = 0; i < packs; i++) for (const c of rollPack('opus', 1, rng, now, rule)) sparks += recycleValue(c)
    assert.ok(sparks / packs < 0.75 * ECONOMY.packs.buyCost, `${rule}: a pack recycles for ${(sparks / packs).toFixed(1)} sparks`)
  }
})

test('regular pack species are uniform over the 8', () => {
  const rng = rngFromSeed('uniform-species')
  const counts = new Map<string, number>()
  let total = 0
  for (let i = 0; i < 4000; i++) for (const c of rollPack('opus', 1, rng, NOW, 'calm')) {
    if (c.rarity === 'legendary') continue
    counts.set(c.species, (counts.get(c.species) ?? 0) + 1)
    total++
  }
  assert.equal(counts.size, 8)
  for (const n of counts.values()) assert.ok(near(n, total, 1 / 8))
})

test('shiny hour makes shinies 1 in 25', () => {
  let day = EPOCH_MS
  while (dailyRule(day) !== 'shinyHour') day += DAY_MS
  const rng = rngFromSeed('shiny-hour')
  let shiny = 0
  for (let i = 0; i < 4000; i++) shiny += rollPack('sonnet', 1, rng, day + 18.5 * 3_600_000).filter(c => c.shiny).length
  assert.ok(near(shiny, 4000, 1 / 25), `${shiny}`)
})

test('wild teams: 1-3 creatures, current season, no legendaries, levels within one', () => {
  const rng = rngFromSeed('wild')
  const sizes = [0, 0, 0, 0]
  const rarity: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  let arena = 0, featured = 0, slots = 0
  const feat = featuredSpecies(NOW)
  for (let i = 0; i < 6000; i++) {
    const team = rollWildTeam({ rng, arena: 'sonnet', now: NOW, level: 4, rule: 'calm', featured: feat })
    sizes[team.length]++
    if (team[0]!.species === 'mythic') continue
    team.forEach((c, slot) => {
      assert.equal(c.id, `wild-${slot}`)
      assert.equal(c.season, 1)
      assert.ok(c.level >= 3 && c.level <= 5)
      assert.equal(c.stage, stageFor(c.level))
      assert.notEqual(c.rarity, 'legendary')
      rarity[c.rarity]++
      if (c.species === feat) featured++
      else if (c.family === 'sonnet') arena++
      slots++
    })
  }
  assert.equal(sizes[0], 0)
  assert.ok(sizes[1]! > 0 && sizes[2]! > 0 && sizes[3]! > 0)
  assert.ok(near(rarity.common, slots, 0.78) && near(rarity.rare, slots, 0.18) && near(rarity.epic, slots, 0.04), JSON.stringify(rarity))
  // the arena family also turns up through the "any family" share, and the featured species through both others
  const featFamily = getSpecies(feat)!.family
  const expectFeatured = 0.15 + (0.5 * (featFamily === 'sonnet' ? 1 : 0) + 0.35 * 0.25) / 8
  assert.ok(near(featured, slots, expectFeatured), `featured ${featured / slots} vs ${expectFeatured}`)
  const expectArena = (0.5 + 0.35 * 0.25) - (featFamily === 'sonnet' ? (0.5 + 0.35 * 0.25) / 8 : 0)
  assert.ok(near(arena, slots, expectArena), `arena ${arena / slots} vs ${expectArena}`)
  for (const c of rollWildTeam({ rng, arena: 'haiku', now: NOW, level: 9 })) assert.doesNotThrow(() => parseBattleCard(c))
})

test('wild levels clamp to 1..10', () => {
  const rng = rngFromSeed('clamp')
  for (let i = 0; i < 300; i++) {
    for (const c of rollWildTeam({ rng, arena: 'opus', now: NOW, level: 1 })) assert.ok(c.level >= 1 && c.level <= 2)
    for (const c of rollWildTeam({ rng, arena: 'opus', now: NOW, level: 10 })) assert.ok(c.level >= 9 && c.level <= 10)
  }
})

test('the weekly roamer leads about 1% of wild teams, as a legendary', () => {
  const rng = rngFromSeed('roamer')
  const roamer = weeklyRoamer(NOW)
  let hits = 0
  const n = 20_000
  for (let i = 0; i < n; i++) {
    const team = rollWildTeam({ rng, arena: 'fable', now: NOW, level: 3, roamer })
    if (team[0]!.species === roamer) {
      hits++
      assert.equal(team[0]!.rarity, 'legendary')
      assert.equal(team[0]!.traits.length, 2)
      assert.equal(team[0]!.stage, 3, 'legendaries are always in their final form')
    }
    for (const c of team.slice(1)) assert.notEqual(c.rarity, 'legendary')
  }
  assert.ok(near(hits, n, (1 - 1 / 40) * 0.01), `${hits}`)
})

test('bounty: a fresh card of the lead species', () => {
  const rng = rngFromSeed('bounty')
  const lead = fighter('opus', {}, 2)
  for (let i = 0; i < 200; i++) {
    const b = rollBounty(lead, rng, NOW, 'calm')
    assert.equal(b.species, lead.species)
    assert.equal(b.origin, 'bounty')
    assert.notEqual(b.rarity, 'legendary')
    assert.doesNotThrow(() => parseCard({ ...b, id: 'b' }))
  }
  const fusionLead = { species: 'fusion', family: 'opus' as const, form: { ...getSpecies('s1-opus-1')!, kind: 'fusion' as const, parents: ['s1-haiku-2', 's1-opus-1'] as [string, string] } }
  assert.equal(rollBounty(fusionLead, rng, NOW, 'calm').species, 's1-opus-1')
  // a legendary is never a bounty: a legendary, roaming or legendary-parent lead gives a regular of its family
  const legendaryLeads = [
    { species: 's1-haiku-8', family: 'haiku' as const },
    { species: weeklyRoamer(NOW), family: getSpecies(weeklyRoamer(NOW))!.family },
    { ...fusionLead, family: 'fable' as const, form: { ...fusionLead.form, family: 'fable' as const, parents: ['s1-opus-1', 's1-fable-8'] as [string, string] } },
  ]
  for (const lead of legendaryLeads) {
    for (let i = 0; i < 100; i++) {
      const b = rollBounty(lead, rng, NOW, 'calm')
      assert.equal(b.family, lead.family)
      assert.equal(getSpecies(b.species)!.legendary, false, `${lead.species} gave a legendary`)
      assert.notEqual(b.rarity, 'legendary')
    }
  }
  const mythicLead = { species: 'mythic', family: 'fable' as const, form: mythicForm('lead') }
  for (let i = 0; i < 20; i++) {
    const b = rollBounty({ ...mythicLead, family: mythicLead.form.family }, rng, NOW, 'calm')
    assert.equal(b.family, mythicLead.form.family)
    assert.equal(getSpecies(b.species)!.legendary, false, 'a Mythic is one of a kind: the bounty is a regular of its family')
  }
  assert.notEqual(otherFamily('haiku', rng), 'haiku')
})

test('1 wild encounter in 40 leads with a Mythic: legendary, foil, final form, its own form', () => {
  const rng = rngFromSeed('mythic-lead')
  const n = 12_000
  const names = new Set<string>()
  let hits = 0
  for (let i = 0; i < n; i++) {
    const team = rollWildTeam({ rng, arena: 'opus', now: NOW, level: 5, roamer: weeklyRoamer(NOW) })
    const lead = team[0]!
    if (lead.species !== 'mythic') continue
    hits++
    assert.equal(lead.id, 'wild-0')
    assert.deepEqual([lead.rarity, lead.foil, lead.stage, lead.form!.kind, lead.form!.legendary], ['legendary', true, 3, 'mythic', true])
    assert.equal(lead.family, lead.form!.family)
    assert.ok(lead.level >= 4 && lead.level <= 6)
    names.add(lead.form!.names[0])
    assert.doesNotThrow(() => parseBattleCard(lead))
    for (const c of team.slice(1)) assert.notEqual(c.species, 'mythic')
  }
  assert.ok(near(hits, n, 1 / 40), `${hits}`)
  assert.ok(names.size >= hits * 0.9, `${names.size} names for ${hits} Mythics`)
})

test('a rested player meets a rare-or-better wild lead', () => {
  const rng = rngFromSeed('rested')
  let epic = 0, n = 0
  for (let i = 0; i < 4000; i++) {
    const team = rollWildTeam({ rng, arena: 'haiku', now: NOW, level: 3, rule: 'calm', rested: true })
    if (team[0]!.species === 'mythic') continue
    n++
    assert.notEqual(team[0]!.rarity, 'common')
    if (team[0]!.rarity === 'epic') epic++
  }
  assert.ok(near(epic, n, 4 / 22), `epic ${epic / n}`)
})

test('beginner\'s luck: the first wild encounter is one level-1 common of the family the lead fares best against', () => {
  const rng = rngFromSeed('first-wild')
  for (const lead of FAMILIES) {
    for (const arena of FAMILIES) {
      for (const rule of ['calm', 'topsyTurvy'] as const) {
        const team = rollFirstWild({ rng, arena, now: NOW, level: 3, rule, lead })
        assert.equal(team.length, 1)
        const c = team[0]!
        assert.deepEqual([c.id, c.rarity, c.level, c.stage, c.season], ['wild-0', 'common', 1, 1, seasonOf(NOW)])
        assert.equal(c.family, rule === 'topsyTurvy' ? beatenBy(lead) : beats(lead))
        assert.ok(typeMult(lead, c.family, rule) > 1 && typeMult(c.family, lead, rule) < 1)
        assert.doesNotThrow(() => parseBattleCard(c))
      }
    }
  }
  // a higher tuned level still sits two below the team's
  const w = ECONOMY.wild as { firstLevel: number }
  const saved = w.firstLevel
  w.firstLevel = 5
  try {
    assert.deepEqual([4, 9].map(level => rollFirstWild({ rng, arena: 'opus', now: NOW, level, lead: 'haiku' })[0]!.level), [2, 5])
  } finally {
    w.firstLevel = saved
  }
})

test('beginner\'s luck: starter teams win the first wild encounter in at least 95% of 2,000 seeds, pressing nothing', () => {
  const n = 2000
  let wins = 0
  for (let i = 0; i < n; i++) {
    const rng = rngFromSeed('first-wild-sim/' + i)
    const now = EPOCH_MS + int(rng, 120) * DAY_MS + int(rng, DAY_MS)
    const rule = dailyRule(now)
    const arena = pick(rng, FAMILIES)
    const attacker = shuffle(rng, starterTeam(pick(rng, FAMILIES), rng, now)).map((c, k) => toBattleCard({ ...c, id: `starter-${k}` }))
    const defender = rollFirstWild({ rng, arena, now, level: ECONOMY.starter.level, rule, lead: attacker[0]!.family })
    const setup = { seed: `first-${i}`, kind: 'wild' as const, arena, rule, rules: RULES_VERSION, attacker, defender }
    if (simulateBattle(setup, []).result === 'win') wins++
  }
  assert.ok(wins >= 0.95 * n, `${wins} of ${n}`)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Rarity } from '../../plugin/hooks/core/types.ts'
import {
  applyXp, cardFromBattleCard, cardName, cardPower, cardStats, craftCost, dnaKey, fuse, geneMult, geneScore, genesFromDna,
  look, mintCard, ownBattleCard, raisingFamily, rarityFits, recycleValue, stageFor, starterTeam, statsOf, toBattleCard, traitsFromDna, xpToNext,
} from '../../plugin/hooks/core/cards.ts'
import { battleRewards } from '../../plugin/hooks/core/battle.ts'
import { beatenBy, beats, inHueRange } from '../../plugin/hooks/core/families.ts'
import { rngFromSeed, uint32 } from '../../plugin/hooks/core/rng.ts'
import { familySpecies, getSpecies, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { parseCard } from '../../plugin/hooks/core/schemas.ts'
import { NOW, card, near, speciesOf } from './helpers.ts'

test('mintCard derives genes and traits from species + dna, deterministically', () => {
  const s = speciesOf('haiku', 2)
  const a = mintCard({ species: s, rarity: 'rare', shiny: false, dna: 123456, origin: 'pack', now: NOW })
  const b = mintCard({ species: s, rarity: 'rare', shiny: false, dna: 123456, origin: 'pack', now: NOW })
  assert.deepEqual(a, b)
  assert.deepEqual(a.genes, genesFromDna(`${s.id}:123456`))
  assert.deepEqual(a.traits, traitsFromDna(`${s.id}:123456`, 1))
  assert.equal(a.species, s.id)
  assert.equal(a.family, 'haiku')
  assert.equal(a.season, 1)
  assert.equal(a.level, 1)
  assert.equal(a.stage, 1)
  assert.equal(a.xp, 0)
  assert.equal(a.state, 'owned')
  assert.equal('form' in a, false)
  assert.deepEqual(a.stats, cardStats(a), 'minted cards carry their stats')
  const c = mintCard({ species: s, rarity: 'rare', shiny: false, dna: 123457, origin: 'pack', now: NOW })
  assert.notDeepEqual([a.genes, a.traits, look({ ...a }).shapeSeed], [c.genes, c.traits, look({ ...c }).shapeSeed])
  assert.equal(dnaKey({ species: s.id, dna: -1 }), `${s.id}:4294967295`)
})

test('trait counts by rarity, never repeated, and every trait is reachable', () => {
  const s = speciesOf('fable', 1)
  const seen = new Set<string>()
  for (let dna = 0; dna < 400; dna++) {
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
      const c = mintCard({ species: s, rarity, shiny: false, dna, origin: 'pack', now: NOW })
      assert.equal(c.traits.length, rarity === 'epic' || rarity === 'legendary' ? 2 : 1)
      assert.equal(new Set(c.traits).size, c.traits.length)
      c.traits.forEach(t => seen.add(t))
      for (const g of c.genes) assert.ok(Number.isInteger(g) && g >= 0 && g <= 15)
    }
  }
  assert.equal(seen.size, 16)
})

test('cardStats follows round(base * gene * rarity * level * stage * trait)', () => {
  const s = speciesOf('opus', 3)
  const c = card(s, { genes: [0, 15, 7, 3], rarity: 'epic', level: 6, stage: 2, traits: ['thickHide', 'ambush'] })
  const common = 1.18 * (1 + 0.07 * 5) * 1.15
  assert.deepEqual(cardStats(c), {
    hp: Math.round(s.base.hp * 0.88 * common),
    atk: Math.round(s.base.atk * (0.88 + 0.016 * 15) * common),
    def: Math.round(s.base.def * (0.88 + 0.016 * 7) * common),
    spd: Math.round(s.base.spd * (0.88 + 0.016 * 3) * common),
  })
  assert.equal(geneMult(0), 0.88)
  assert.ok(Math.abs(geneMult(15) - 1.12) < 1e-12)
  const plain = cardStats({ ...c, traits: ['ambush'] })
  const swift = cardStats({ ...c, traits: ['swift'] })
  const glass = cardStats({ ...c, traits: ['glassHeart'] })
  const sleepy = cardStats({ ...c, traits: ['sleepy'] })
  assert.equal(swift.spd, Math.round(s.base.spd * (0.88 + 0.016 * 3) * common * 1.15))
  assert.equal(glass.atk, Math.round(s.base.atk * (0.88 + 0.016 * 15) * common * 1.2))
  assert.equal(glass.hp, Math.round(s.base.hp * 0.88 * common * 0.85))
  assert.equal(sleepy.hp, Math.round(s.base.hp * 0.88 * common * 1.15))
  assert.equal(sleepy.spd, Math.round(s.base.spd * (0.88 + 0.016 * 3) * common * 0.9))
  assert.equal(plain.def, swift.def)
  const p = cardStats(c)
  assert.equal(cardPower(c), p.hp + 2 * p.atk + 2 * p.def + p.spd)
  assert.deepEqual(statsOf({ ...c, stats: { hp: 1, atk: 2, def: 3, spd: 4 } }), { hp: 1, atk: 2, def: 3, spd: 4 }, 'server stats win')
  const { stats: _s, ...bare } = c
  assert.deepEqual(statsOf(bare), cardStats(c))
})

test('rarity, level and stage all raise stats', () => {
  const s = speciesOf('sonnet', 0)
  const { stats: _stats, ...base } = card(s, { genes: [8, 8, 8, 8], traits: ['ambush'] })
  const powers = (['common', 'rare', 'epic', 'legendary'] as Rarity[]).map(r => cardPower({ ...base, rarity: r }))
  assert.deepEqual([...powers].sort((a, b) => a - b), powers)
  assert.ok(cardPower({ ...base, level: 10 }) > cardPower({ ...base, level: 9 }))
  assert.ok(cardPower({ ...base, stage: 2 }) > cardPower(base))
  assert.ok(cardPower({ ...base, stage: 3 }) > cardPower({ ...base, stage: 2 }))
  const st = (stage: 1 | 2 | 3) => cardStats({ ...base, genes: [15, 15, 15, 15], level: 10, stage }).hp
  assert.ok(Math.abs(st(2) / st(1) - 1.15) < 0.03 && Math.abs(st(3) / st(1) - 1.3) < 0.03)
})

test('gene score is sum / 60 as a percentage', () => {
  assert.equal(geneScore([0, 0, 0, 0]), 0)
  assert.equal(geneScore([15, 15, 15, 15]), 100)
  assert.equal(geneScore([15, 0, 15, 0]), 50)
  assert.equal(geneScore([1, 2, 3, 4]), 17)
})

test('looks: hue within ±18 and inside the family range; pattern default 80%; trinket 5%', () => {
  let kept = 0, trinkets = 0
  const n = 6000
  const s = speciesOf('opus', 4)
  for (let dna = 0; dna < n; dna++) {
    const l = look({ species: s.id, dna, shiny: false })
    assert.ok(inHueRange('opus', l.hue), String(l.hue))
    const d = Math.abs((((l.hue - s.hue) % 360) + 540) % 360 - 180)
    assert.ok(d <= 18.05, `hue drift ${d}`)
    assert.ok(Math.abs(l.sat) <= 0.08 && Math.abs(l.light) <= 0.06)
    if (l.pattern === s.pattern) kept++
    if (l.trinket !== 'none') trinkets++
  }
  assert.ok(near(kept, n, 0.8 + 0.2 / 5), `pattern kept ${kept / n}`)
  assert.ok(near(trinkets, n, 0.05), `trinkets ${trinkets / n}`)
  assert.deepEqual(look({ species: s.id, dna: 99, shiny: true }), { ...look({ species: s.id, dna: 99, shiny: false }), shiny: true })
})

test('three stages: stage 2 at level 4, stage 3 at level 8', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(stageFor), [1, 1, 1, 2, 2, 2, 2, 3, 3, 3])
  const s = speciesOf('haiku', 1)
  for (let level = 1; level <= 10; level++) assert.equal(mintCard({ species: s, rarity: 'common', shiny: false, dna: 1, origin: 'pack', now: NOW, level }).stage, stageFor(level))
})

test('applyXp levels at 40 * level, evolves at 4 and 8, fixes the raising family, stops at 10', () => {
  const s = speciesOf('haiku', 1)
  const c = card(s)
  assert.equal(xpToNext(1), 40)
  let r = applyXp(c, 39)
  assert.deepEqual([r.card.level, r.card.xp, r.levelsGained, r.evolved], [1, 39, 0, false])
  r = applyXp(c, 40)
  assert.deepEqual([r.card.level, r.card.xp], [2, 0])
  r = applyXp(c, 40 + 80 + 120 + 5, 'opus')
  assert.deepEqual([r.card.level, r.card.xp, r.card.stage, r.levelsGained, r.evolved, r.card.raisedIn], [4, 5, 2, 3, true, 'opus'])
  assert.deepEqual(r.card.stats, cardStats(r.card), 'stats follow the new level and stage')
  const two = r.card
  r = applyXp(two, 20, 'sonnet')
  assert.equal(r.evolved, false)
  r = applyXp(two, 160 + 200 + 240 + 280, 'sonnet')
  assert.deepEqual([r.card.level, r.card.stage, r.evolved, r.card.raisedIn], [8, 3, true, 'opus'], 'the raising family is fixed at the first evolution')
  r = applyXp(c, 100_000)
  assert.deepEqual([r.card.level, r.card.xp, r.card.stage, r.card.raisedIn], [10, 0, 3, 'haiku'], 'with no raising family given, raised at home')
  assert.equal(c.level, 1, 'input untouched')
  assert.equal(applyXp(c, -50).card.xp, 0)
  assert.equal(cardName(c), s.names[0])
  assert.equal(cardName(applyXp(c, 300).card), s.names[1])
  assert.equal(cardName(r.card), s.names[2])
  // minimal objects work too, and keep their shape
  assert.deepEqual(applyXp({ level: 3, xp: 0, stage: 1 }, 120), { card: { level: 4, xp: 0, stage: 2 }, levelsGained: 1, evolved: true })
})

test('legendaries are minted in their final form and never evolve', () => {
  const l = getSpecies('s1-opus-8')!
  const c = card(l)
  assert.deepEqual([c.stage, c.rarity, c.foil], [3, 'legendary', true])
  const s = cardStats(c)
  assert.equal(s.hp, Math.max(1, Math.round(l.base.hp * geneMult(c.genes[0]) * 1.3 * 1.3)))
  const r = applyXp(c, 100_000)
  assert.deepEqual([r.card.stage, r.evolved, r.card.raisedIn], [3, false, undefined])
  assert.equal(cardName(c), l.names[2])
})

test('raising family: the arena it battled in most; ties and no battles go home', () => {
  assert.equal(raisingFamily({}, 'haiku'), 'haiku')
  assert.equal(raisingFamily({ opus: 3, haiku: 1 }, 'haiku'), 'opus')
  assert.equal(raisingFamily({ opus: 3, haiku: 3 }, 'haiku'), 'haiku')
  assert.equal(raisingFamily({ opus: 3, sonnet: 3, haiku: 1 }, 'haiku'), 'haiku')
  assert.equal(raisingFamily({ opus: 1, sonnet: 1, fable: 5 }, 'haiku'), 'fable')
  assert.equal(raisingFamily({ haiku: 2 }, 'haiku'), 'haiku')
})

test('fusion: body from A, family and palette from B, names, level, genes, traits', () => {
  const sa = familySpecies(1, 'haiku').find(s => !s.legendary)!
  const sb = familySpecies(1, 'opus').find(s => !s.legendary && s.body !== sa.body)!
  const a = card(sa, { level: 4, genes: [2, 4, 6, 8], rarity: 'rare', traits: ['swift'] }, 11)
  const b = card(sb, { level: 7, stage: 2, genes: [10, 12, 14, 0], rarity: 'common', traits: ['regrowth'] }, 12)
  const h = fuse(a, b, rngFromSeed('fuse'), NOW)
  assert.equal(h.species, 'fusion')
  assert.equal(h.family, 'opus')
  assert.equal(h.form!.kind, 'fusion')
  assert.equal(h.form!.family, 'opus')
  assert.equal(h.form!.body, sa.body)
  assert.equal(h.form!.accessory, sa.accessory)
  assert.equal(h.form!.hue, look(b).hue)
  assert.equal(h.form!.legendary, false)
  assert.deepEqual(h.form!.parents, [sa.id, sb.id])
  assert.equal(h.form!.names.length, 3)
  assert.equal(h.level, Math.max(1, Math.floor((4 + 7) / 2) - 1))
  assert.equal(h.stage, stageFor(h.level))
  assert.deepEqual(h.stats, cardStats(h))
  for (let i = 0; i < 4; i++) {
    const avg = (a.genes[i]! + b.genes[i]!) / 2
    assert.ok(Math.abs(h.genes[i]! - avg) <= 2.5 && h.genes[i]! >= 0 && h.genes[i]! <= 15)
  }
  assert.ok(['rare', 'epic'].includes(h.rarity))
  assert.equal(h.traits.length, h.rarity === 'epic' ? 2 : 1)
  if (h.rarity === 'epic') assert.deepEqual([...h.traits].sort(), ['regrowth', 'swift'])
  else assert.ok(['regrowth', 'swift'].includes(h.traits[0]!))
  assert.equal(h.origin, 'fusion')
  assert.doesNotThrow(() => parseCard({ ...h, id: 'f1' }))
  assert.ok(cardStats({ ...h }).hp > 0)
})

test('fusion names: three stages, new to the season, the same for the same parents', () => {
  const all = seasonSpecies(1).filter(s => !s.legendary)
  const species = new Set(seasonSpecies(1).flatMap(s => s.names.map(n => n.toLowerCase())))
  for (const [x, y] of [[all[0]!, all[12]!], [all[3]!, all[30]!], [all[5]!, all[5]!]] as const) {
    const one = fuse(card(x, {}, 1), card(y, {}, 2), rngFromSeed('n1'), NOW).form!.names
    const two = fuse(card(x, {}, 3), card(y, { level: 6, stage: 2 }, 4), rngFromSeed('n2'), NOW).form!.names
    assert.deepEqual(one, two, 'same parents, same names')
    assert.equal(new Set(one).size, 3)
    for (const n of one) {
      assert.match(n, /^[A-Z][a-z]+$/)
      assert.ok(!species.has(n.toLowerCase()), `${n} is a species name`)
    }
  }
})

test('fusion rarity: highest parent, 15% one tier up, never into legendary', () => {
  const s = speciesOf('sonnet', 1)
  const common = card(s, { rarity: 'common' }, 1), epic = card(s, { rarity: 'epic', traits: ['swift', 'mimic'] }, 2)
  const leg = card(getSpecies('s1-sonnet-8')!, {}, 3)
  const rng = rngFromSeed('tier')
  let ups = 0
  const n = 4000
  for (let i = 0; i < n; i++) {
    const r = fuse(common, common, rng, NOW).rarity
    assert.ok(r === 'common' || r === 'rare')
    if (r === 'rare') ups++
    assert.equal(fuse(common, epic, rng, NOW).rarity, 'epic')
    const hybrid = fuse(leg, common, rng, NOW)
    assert.deepEqual([hybrid.rarity, hybrid.foil], ['legendary', true], 'every legendary is foil, a hybrid one too')
  }
  assert.ok(near(ups, n, 0.15), `tier up ${ups / n}`)
})

test('two fusions of the same parents never look identical', () => {
  const a = card(speciesOf('fable', 2), {}, 5), b = card(speciesOf('haiku', 3), {}, 6)
  const rng = rngFromSeed('twice')
  const x = fuse(a, b, rng, NOW), y = fuse(a, b, rng, NOW)
  assert.notEqual(x.dna, y.dna)
  assert.notDeepEqual(look({ ...x }), look({ ...y }))
})

test('recycle values (shiny 2x, foil 1.5x, Mythic 2x), craft costs, rarity fit', () => {
  const s = speciesOf('opus', 0)
  const sp = 's1-opus-0'
  assert.equal(recycleValue({ species: sp, rarity: 'common', shiny: false }), 4)
  assert.equal(recycleValue({ species: sp, rarity: 'rare', shiny: false }), 15)
  assert.equal(recycleValue({ species: sp, rarity: 'epic', shiny: true }), 120)
  assert.equal(recycleValue({ species: sp, rarity: 'legendary', shiny: true }), 500)
  assert.equal(recycleValue({ species: sp, rarity: 'rare', shiny: false, foil: true }), 23)
  assert.equal(recycleValue({ species: 's1-opus-8', rarity: 'legendary', shiny: false, foil: true }), 375)
  assert.equal(recycleValue({ species: 'mythic', rarity: 'legendary', shiny: false, foil: true }), 750)
  assert.deepEqual((['common', 'rare', 'epic', 'legendary'] as Rarity[]).map(craftCost), [50, 200, 800, 3200])
  assert.equal(rarityFits(s, 'epic'), true)
  assert.equal(rarityFits(s, 'legendary'), false)
  assert.equal(rarityFits(getSpecies('s1-opus-8')!, 'legendary'), true)
  assert.equal(rarityFits(getSpecies('s1-opus-8')!, 'rare'), false)
})

test('starter team: three bound level-3 commons, one good battle from evolving', () => {
  for (const f of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    const team = starterTeam(f, rngFromSeed('start-' + f), NOW)
    assert.deepEqual(team.map(c => c.family), [f, beats(f), beatenBy(f)])
    for (const c of team) {
      assert.equal(c.rarity, 'common')
      assert.equal(c.level, 3)
      assert.equal(c.stage, 1)
      assert.equal(c.bound, true)
      const won = applyXp(c, battleRewards('wild', 'win', 'calm').xp)
      assert.deepEqual([won.card.level, won.card.stage, won.evolved], [4, 2, true])
      assert.equal(applyXp(c, battleRewards('wild', 'loss', 'calm').xp).evolved, false)
      assert.equal(c.origin, 'starter')
      assert.equal(getSpecies(c.species)!.legendary, false)
      assert.doesNotThrow(() => parseCard({ ...c, id: 'x' }))
    }
  }
})

test('battle card round trip keeps the creature and drops ownership and the raised look', () => {
  const c: Card = card(speciesOf('haiku', 5), { level: 6, stage: 2, raisedIn: 'fable', forTrade: true, bound: true, firstFind: true }, uint32(rngFromSeed('rt')))
  const bc = toBattleCard(c)
  assert.deepEqual(Object.keys(bc).sort(), ['dna', 'family', 'firstFind', 'genes', 'id', 'level', 'rarity', 'season', 'shiny', 'species', 'stage', 'stats', 'traits'])
  assert.equal(bc.raisedIn, undefined, 'the arena a card grew up in is never shown to others (SPEC 20.3)')
  assert.deepEqual(ownBattleCard(c), { ...bc, raisedIn: 'fable' }, 'the owner still sees it in their own battles')
  assert.equal(ownBattleCard(card(speciesOf('haiku', 5), {}, 3)).raisedIn, undefined)
  assert.deepEqual(bc.stats, cardStats(c))
  const back = cardFromBattleCard(bc, 'catch', NOW + 5)
  assert.deepEqual([back.species, back.dna, back.genes, back.traits, back.level, back.stage, back.raisedIn, back.stats], [c.species, c.dna, c.genes, c.traits, c.level, c.stage, undefined, c.stats])
  assert.deepEqual([back.bound, back.forTrade, back.origin, back.mintedAt, back.xp, back.firstFind], [false, false, 'catch', NOW + 5, 0, undefined])
  assert.doesNotThrow(() => parseCard({ ...back, id: 'x' }))
})

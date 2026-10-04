import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FAMILIES, FAMILY_INFO, SPECIALS, beatenBy, beats, clampHue, familyOfModel, inHueRange, typeMult,
} from '../../plugin/hooks/core/families.ts'
import { hashString } from '../../plugin/hooks/core/rng.ts'
import {
  BODIES, GENERATOR_VERSION, formOf, getSpecies, installSeason, isBlocked, isFinalForm, isFormKind, legendaryOf, seasonSpecies,
} from '../../plugin/hooks/core/species.ts'
import { fusionNameLine, mythicNameFor, rivalName, speciesNameLine } from '../../plugin/hooks/core/naming.ts'
import { mythicForm } from '../../plugin/hooks/core/mythics.ts'
import { TRAITS, TRAIT_IDS, isTrait } from '../../plugin/hooks/core/traits.ts'

test('model ids map to families; unknown models hash in FAMILIES order', () => {
  assert.equal(familyOfModel('claude-opus-5-5'), 'opus')
  assert.equal(familyOfModel('claude-haiku-4-5-20251001'), 'haiku')
  assert.equal(familyOfModel('Claude-Sonnet-5.5'), 'sonnet')
  assert.equal(familyOfModel('fable'), 'fable')
  for (const id of ['gpt-x', 'mystery-model', '']) assert.equal(familyOfModel(id), FAMILIES[hashString(id) % 4])
})

test('type cycle: opus > sonnet > haiku > fable > opus, reversed on Topsy-Turvy', () => {
  assert.equal(beats('opus'), 'sonnet')
  assert.equal(beats('sonnet'), 'haiku')
  assert.equal(beats('haiku'), 'fable')
  assert.equal(beats('fable'), 'opus')
  for (const f of FAMILIES) assert.equal(beats(beatenBy(f)), f)
  for (const a of FAMILIES) for (const d of FAMILIES) {
    const expected = beats(a) === d ? 1.5 : beats(d) === a ? 0.67 : 1
    assert.equal(typeMult(a, d), expected, `${a} vs ${d}`)
    assert.equal(typeMult(a, d, 'topsyTurvy'), beats(d) === a ? 1.5 : beats(a) === d ? 0.67 : 1, `topsy ${a} vs ${d}`)
  }
})

test('family table matches the spec', () => {
  assert.deepEqual(FAMILY_INFO.haiku.hue, [85, 165])
  assert.deepEqual(FAMILY_INFO.opus.hue, [345, 40])
  for (const f of FAMILIES) {
    const b = FAMILY_INFO[f].bias
    assert.equal(b.hp + b.atk + b.def + b.spd, 100)
  }
  assert.deepEqual(FAMILY_INFO.opus.bias, { hp: 34, atk: 30, def: 24, spd: 12 })
  assert.equal(SPECIALS.flurry.hits, 2)
  assert.equal(SPECIALS.flurry.mult, 0.9)
  assert.equal(SPECIALS.couplet.heal, 0.15)
  assert.equal(SPECIALS.crescendo.mult, 2.1)
  assert.equal(SPECIALS.twist.alwaysSuper, true)
})

test('hue clamping respects ranges, including the one that wraps through 0', () => {
  assert.equal(clampHue('opus', 10), 10)
  assert.equal(clampHue('opus', 350), 350)
  assert.equal(clampHue('opus', 50), 40)
  assert.equal(clampHue('opus', 330), 345)
  assert.equal(clampHue('opus', -5), 355)
  assert.equal(clampHue('haiku', 60), 85)
  assert.equal(clampHue('haiku', 200), 165)
  assert.equal(clampHue('fable', 0), 320)
  for (const f of FAMILIES) for (let h = -360; h < 720; h += 7) assert.ok(inHueRange(f, clampHue(f, h)), `${f} ${h}`)
})

test('every season has 36 species: 8 regular + 1 legendary per family, ids s{season}-{family}-{index}', () => {
  for (const season of [1, 2, 3, 7, 12, 99]) {
    const list = seasonSpecies(season)
    assert.equal(list.length, 36)
    for (const f of FAMILIES) {
      const fam = list.filter(s => s.family === f)
      assert.deepEqual(fam.map(s => s.index), [0, 1, 2, 3, 4, 5, 6, 7, 8])
      assert.deepEqual(fam.map(s => s.legendary), [false, false, false, false, false, false, false, false, true])
      for (const s of fam) {
        assert.equal(s.id, `s${season}-${f}-${s.index}`)
        assert.equal(s.season, season)
        assert.ok(inHueRange(f, s.hue), `${s.id} hue ${s.hue}`)
        assert.ok(BODIES.includes(s.body))
      }
      assert.ok(new Set(fam.slice(0, 8).map(s => s.body)).size >= 5, `season ${season} ${f} body variety`)
      assert.ok(['crown', 'halo'].includes(fam[8]!.accessory))
    }
  }
})

test('species are memoised, frozen and deterministic', () => {
  assert.equal(seasonSpecies(4), seasonSpecies(4))
  assert.ok(Object.isFrozen(seasonSpecies(4)[0]))
  assert.ok(Object.isFrozen(seasonSpecies(4)[0]!.base))
  assert.throws(() => seasonSpecies(0))
  assert.throws(() => seasonSpecies(1.5))
})

test('names: three stages, unique per season, title case, 4-11 letters, never blocked; legendaries keep one name', () => {
  for (let season = 1; season <= 40; season++) {
    const list = seasonSpecies(season)
    const names = list.flatMap(s => (s.legendary ? [s.names[0]] : s.names))
    assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, `season ${season} duplicate names`)
    for (const s of list) {
      assert.equal(s.names.length, 3)
      if (s.legendary) {
        assert.equal(s.names[1], s.names[0])
        assert.equal(s.names[2], s.names[0])
        assert.match(s.names[0], /^[A-Z][a-z]{3,15}$/)
        continue
      }
      for (const n of s.names) {
        assert.match(n, /^[A-Z][a-z]{3,10}$/)
        assert.equal(isBlocked(n), false, n)
      }
    }
  }
})

test('the name seam: species, fusion, Mythic and Rival names are deterministic and clean', () => {
  const line = speciesNameLine('spinlings/season/1/opus/3', 'opus', false, [])
  assert.deepEqual(speciesNameLine('spinlings/season/1/opus/3', 'opus', false, []), line)
  assert.ok(!speciesNameLine('spinlings/season/1/opus/3', 'opus', false, line).some(n => line.includes(n)), 'taken names are never reused')
  assert.deepEqual(fusionNameLine('Pipkin', 'Fogmaw', []), fusionNameLine('Pipkin', 'Fogmaw', []))
  const seen = new Set<string>()
  for (let i = 0; i < 300; i++) {
    const m = mythicNameFor('seed-' + i)
    assert.match(m, /^[A-Z][a-z]{4,11} [A-Z][a-z]{4,11}$/)
    assert.equal(isBlocked(m), false)
    seen.add(m)
    assert.match(rivalName('r' + i), /^[A-Z][a-z]{4,15}$/)
  }
  assert.ok(seen.size > 250, `${seen.size} distinct Mythic names`)
})

test('the blocklist catches rude words, other franchises and tongue twisters', () => {
  for (const n of ['Hobbit', 'Inkling', 'Twiglet', 'Pikachu', 'Shitling', 'Quilllord', 'Mothra']) assert.equal(isBlocked(n), true, n)
  for (const n of ['Pipkin', 'Brassbit', 'Fogmaw', 'Gloamsprout']) assert.equal(isBlocked(n), false, n)
})

test('base stats: budget split by bias, jitter within 8, legendary 1.15x', () => {
  for (const s of seasonSpecies(1)) {
    const b = FAMILY_INFO[s.family].bias
    const m = s.legendary ? 1.15 : 1
    const share = { hp: s.base.hp / m - 20, atk: (s.base.atk / m - 4) * 2, def: (s.base.def / m - 3) * 2, spd: (s.base.spd / m - 1) * 2 }
    for (const k of ['hp', 'atk', 'def', 'spd'] as const) {
      assert.ok(Math.abs(share[k] - b[k]) <= 8 + 0.05, `${s.id} ${k}`)
      if (!s.legendary) assert.ok(Number.isInteger(share[k]), `${s.id} ${k} share`)
    }
  }
})

test('getSpecies, legendaryOf, formOf', () => {
  assert.equal(getSpecies('s1-opus-8')!.legendary, true)
  assert.equal(getSpecies('s2-fable-3')!.season, 2)
  for (const bad of ['s0-opus-1', 's1-opus-9', 's1-dragon-1', 'fusion', 's01-opus-1', ' s1-opus-1']) assert.equal(getSpecies(bad), undefined, bad)
  assert.equal(legendaryOf(3, 'haiku').id, 's3-haiku-8')
  assert.equal(formOf({ species: 's1-haiku-2' }), getSpecies('s1-haiku-2'))
  assert.throws(() => formOf({ species: 's1-nope-2' }))
  assert.throws(() => formOf({ species: 'fusion' }))
  assert.throws(() => formOf({ species: 'mythic' }))
  const m = mythicForm('x')
  assert.equal(formOf({ species: 'mythic', form: m }), m)
  assert.equal(isFinalForm({ species: 'mythic', form: m }), true)
  assert.equal(isFinalForm({ species: 's1-opus-8' }), true)
  assert.equal(isFinalForm({ species: 's1-opus-1' }), false)
  assert.deepEqual(['fusion', 'mythic', 'promo', 's1-opus-1', 'toString'].map(isFormKind), [true, true, true, false, false])
})

test('a season frozen by the server replaces only its explicit catalog; bad lists are refused', () => {
  assert.equal(GENERATOR_VERSION, 2)
  const frozen = JSON.parse(JSON.stringify(seasonSpecies(77))) as ReturnType<typeof seasonSpecies>[number][]
  const catalog = new Map()
  const original = getSpecies('s77-haiku-0')!
  frozen[0] = { ...frozen[0]!, names: ['Frostlet', 'Frostmaw', 'Frosttitan'] }
  assert.equal(installSeason(77, frozen.slice(1), catalog), false)
  assert.equal(installSeason(78, frozen, catalog), false, 'wrong season')
  assert.equal(installSeason(77, frozen, catalog), true)
  assert.deepEqual(getSpecies('s77-haiku-0', catalog)!.names, ['Frostlet', 'Frostmaw', 'Frosttitan'])
  assert.ok(Object.isFrozen(getSpecies('s77-haiku-0', catalog)))
  assert.strictEqual(getSpecies('s77-haiku-0'), original, 'offline generation is unchanged')
})

test('legendary and Mythic parents with an awkward front still fuse into three clean names, the same every time', () => {
  // "Neth-" is a blocked opening and "Bri-" takes no stage-2 ending: the generator finds another front from A
  for (const [a, b] of [['Netherhowl', 'Figmink'], ['Briarvale Snowpaw', 'Foamlute']] as const) {
    const line = fusionNameLine(a, b, [])
    assert.deepEqual(fusionNameLine(a, b, []), line)
    assert.equal(new Set(line).size, 3, line.join())
    for (const n of line) {
      assert.match(n, /^[A-Z][a-z]{3,10}$/)
      assert.equal(isBlocked(n), false, n)
      assert.ok(n.startsWith(a.slice(0, 2)), `${n} keeps the front of ${a}`)
    }
  }
})

test('all 16 traits have a name and a description, with no developer words', () => {
  assert.equal(TRAIT_IDS.length, 16)
  assert.deepEqual(Object.keys(TRAITS).sort(), [...TRAIT_IDS].sort())
  for (const t of TRAIT_IDS) {
    assert.ok(isTrait(t))
    assert.ok(TRAITS[t].name.length > 0 && TRAITS[t].text.length > 0)
    assert.doesNotMatch(TRAITS[t].text + TRAITS[t].name, /\b(bug|code|compile|deploy|commit|merge|debug|stack|token|git)\b/i)
  }
  assert.equal(isTrait('toString'), false)
})

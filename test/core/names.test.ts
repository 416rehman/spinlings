import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Family } from '../../plugin/hooks/core/types.ts'
import {
  LEGENDARY_SHAPE, MIN_SCORE, MYTHIC_WORD_SHAPE, STAGE_SHAPE, blockReason, builtEndings, compoundWords, editDistance,
  endingKey, endingSource, familyFit, familyRoots, fusionLine, fusionName, isNearDuplicate, isSpeciesName, junctions,
  legendaryNames, mythicName, nameRoot, nameStem, phonotactics, pronounceability, rootWords, smallWords, sourceTails,
  speciesNames, syllables,
} from '../../plugin/hooks/core/names.ts'
import type { Stage } from '../../plugin/hooks/core/names.ts'
import { BLOCKED_WORDS, fusionNameLine, isBlocked, mythicNameFor } from '../../plugin/hooks/core/naming.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'

const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']
type Shape = { syllables: readonly [number, number]; letters: readonly [number, number] }
type Line = [string, string, string]

function assertShape(name: string, shape: Shape, label: string): void {
  const syl = syllables(name)
  assert.ok(name.length >= shape.letters[0] && name.length <= shape.letters[1], `${label} ${name}: ${name.length} letters`)
  assert.ok(syl >= shape.syllables[0] && syl <= shape.syllables[1], `${label} ${name}: ${syl} syllables`)
}

function assertClean(name: string, label: string): void {
  assert.equal(phonotactics(name), null, `${label} ${name}`)
  assert.equal(blockReason(name), null, `${label} ${name}`)
  assert.ok(pronounceability(name) >= MIN_SCORE, `${label} ${name}: score ${pronounceability(name)}`)
  assert.match(name, /^[A-Z][a-z]+( [A-Z][a-z]+)?$/, `${label} ${name}: title case letters`)
}

// Samples shared by the tests: lines from free seeds, three years of real seasons drawn as species.ts draws them,
// legendaries, Mythics and fusions built the way cards.ts builds them.
const lines: { family: Family; line: Line }[] = []
for (let i = 0; i < 125; i++) for (const f of FAMILIES) lines.push({ family: f, line: speciesNames(`test/${f}/${i}`, f) })
const YEAR = 13
const SEASONS = 3 * YEAR
const seasons: { season: number; family: Family; index: number; line: Line }[] = []
const seasonNames: string[][] = []
for (let s = 1; s <= SEASONS; s++) {
  const taken: string[] = []
  for (const f of FAMILIES) {
    for (let i = 0; i <= 8; i++) {
      const line = speciesNames(`spinlings/season/${s}/${f}/${i}`, f, i === 8, taken)
      taken.push(...new Set(line))
      seasons.push({ season: s, family: f, index: i, line })
    }
  }
  seasonNames.push(taken)
}
const allSpecies = new Set(seasonNames.flat())
const regular = [...lines, ...seasons.filter(x => x.index < 8)]
const yearOf = (f: Family, y: number) => seasons.filter(x => x.family === f && x.index < 8 && x.season > y * YEAR && x.season <= (y + 1) * YEAR)
const legends: { family: Family; name: string }[] = []
for (let i = 0; i < 25; i++) for (const f of FAMILIES) legends.push({ family: f, name: speciesNames(`test/${f}/legend/${i}`, f, true)[2] })
const mythics: string[] = []
for (let i = 0; i < 150; i++) mythics.push(mythicName(`test/mythic/${i}`))
const fusions: { a: string; b: string; line: Line }[] = []
for (let k = 0; k < 120; k++) {
  const s = 1 + (k % YEAR)
  const pool = seasons.filter(x => x.season === s && x.index < 8)
  const a = pool[(k * 7) % pool.length]!.line[0]
  const b = pool[(k * 11 + 3) % pool.length]!.line[0]
  if (a !== b) fusions.push({ a, b, line: fusionLine(a, b, seasonNames[s - 1]!) })
}
const lower = (n: string) => n.toLowerCase()

test('2,000 generated names all pass the phonotactic rules and every blocklist', () => {
  const all = [
    ...regular.flatMap(l => l.line), ...legends.map(l => l.name), ...seasons.filter(x => x.index === 8).map(x => x.line[2]),
    ...mythics.flatMap(m => m.split(' ')), ...fusions.flatMap(f => f.line),
  ]
  assert.ok(all.length >= 2000, `only ${all.length} names`)
  for (const n of all) assertClean(n, 'generated')
  for (const m of mythics) assert.equal(blockReason(m), null, m)
})

test('no name reads rude, a brand or an insult by sound: rapin, tard, -cock, bollocks, eBay, weirdo, Aldi, pimp', () => {
  const all = [...regular.flatMap(l => l.line), ...fusions.flatMap(f => f.line), ...mythics.flatMap(m => m.split(' '))]
  for (const n of all) {
    const heard = lower(n).replace(/ck/g, 'k').replace(/c(?![eiy])/g, 'k').replace(/x/g, 'ks').replace(/([^aeiou])\1/g, '$1')
    assert.doesNotMatch(heard, /rapin|t[aeiou]rd|kok|b[aeiou]l[aeiou]ks|^eba[yi]|w(?:ei|y)rdo|^aldi|pimp|gimp|[ck]ovid|orvid/, n)
  }
  // the critique's readings are all refused, by spelling or by sound
  for (const n of [
    'Amberrapin', 'Cinderrapin', 'Moltard', 'Sootard', 'Tuftardinal', 'Oakock', 'Tuskock', 'Barkock', 'Bullox',
    'Lupimpala', 'Ebbay', 'Wyrdo', 'Aldit', 'Aldisp', 'Aldimalkin', 'Plovix', 'Tulkit', 'Tulin', 'Purlo', 'Purlauk',
    'Ebbauk', 'Snowauk', 'Rookisp', 'Mothisp', 'Rumbag', 'Rumbettin', 'Kilnock', 'Kilninotaur', 'Weasmite', 'Weasnib',
    'Mista', 'Mistern', 'Mistermaid', 'Gusto', 'Fogorvid', 'Croworvid', 'Elmitten', 'Nimbitten', 'Sootax', 'Oakox',
    'Oakax', 'Hornax', 'Ambad', 'Ambag', 'Owladder', 'Plummit', 'Hornot', 'Peakan', 'Bullnado', 'Elfo', 'Fennix',
    'Bullgoyle', 'Moonturne', 'Gulletrel', 'Surfyl', 'Gustane', 'Foamine', 'Boggimp', 'Drumur', 'Peakar', 'Bullean',
  ]) {
    assert.ok(blockReason(n) !== null || phonotactics(n) !== null || pronounceability(n) < MIN_SCORE, `${n} is allowed`)
  }
})

test('stage names keep to the letters and syllables of SPEC section 23', () => {
  for (const { line } of regular) line.forEach((n, i) => assertShape(n, STAGE_SHAPE[(i + 1) as Stage], `stage ${i + 1}`))
})

test('evolution lines keep their root and grow: longer at every stage, and a syllable and two letters by stage 3', () => {
  for (const { line } of regular) {
    const [a, b, c] = line.map(lower) as [string, string, string]
    const label = line.join(' > ')
    const root = nameRoot(a)
    assert.ok(root, `${label}: no known root`)
    assert.ok(line.every(n => nameRoot(n) === root) && b.startsWith(a.slice(0, 3)) && c.startsWith(a.slice(0, 3)), `${label} changes root`)
    assert.ok(b.length > a.length && c.length > b.length && c.length >= a.length + 2, `${label}: letters do not grow`)
    assert.ok(syllables(c) >= syllables(b) && syllables(b) >= syllables(a) && syllables(c) > syllables(a), `${label}: syllables do not grow`)
    assert.ok(editDistance(a, b) >= 3 && editDistance(b, c) >= 3 && editDistance(a, c) >= 3, `${label}: stages too alike`)
  }
})

test('stage 1 is never a stock suffix, a hesitation or a nickname', () => {
  // a vowel pair such as -ay is fine; a consonant + y reads as a nickname (Caty, Puddy, Jaspy)
  for (const { family, line } of regular) {
    // a small creature word is itself (Twilfox); anything else must not end like a stock suffix
    if (smallWords(family).includes(endingKey(line[0]))) continue
    assert.doesNotMatch(line[0], /(um|ug|ick|ee|ie|[^aeiou]y|isp|esk|yr|ix|ox|ax)$/i, line.join(' > '))
  }
})

test('stage 1 is a small creature word for at least half of every family, and otherwise an ending built for it', () => {
  for (const f of FAMILIES) {
    const smalls = new Set(smallWords(f))
    const built = new Set(builtEndings(f, 1))
    const share = (ls: { line: Line }[]) => ls.filter(x => smalls.has(endingKey(x.line[0]))).length / ls.length
    assert.ok(share(yearOf(f, 0)) >= 0.5, `${f}: ${(100 * share(yearOf(f, 0))).toFixed(0)}% small words in the first year`)
    const threeYears = seasons.filter(x => x.family === f && x.index < 8)
    assert.ok(share(threeYears) >= 0.45, `${f}: ${(100 * share(threeYears)).toFixed(0)}% small words over three years`)
    for (const { line } of threeYears) {
      const key = endingKey(line[0])
      assert.ok(smalls.has(key) || built.has(key), `${line[0]}: ${key} is neither a small word nor built for ${f}`)
    }
  }
})

test('within a year no ending recurs often: a stage-2 or stage-3 word ends at most three lines, a small word six', () => {
  for (const f of FAMILIES) {
    for (let y = 0; y < 3; y++) {
      const counts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()]
      for (const { line } of yearOf(f, y)) line.forEach((n, s) => counts[s]!.set(endingKey(n), (counts[s]!.get(endingKey(n)) ?? 0) + 1))
      const smalls = new Set(smallWords(f))
      for (const [key, c] of counts[0]!) if (smalls.has(key)) assert.ok(c <= 6, `${f} year ${y + 1}: ${key} ends ${c} stage-1 names`)
      for (const s of [1, 2]) {
        for (const [key, c] of counts[s]!) {
          if (sourceTails(f, s as 2 | 3).some(t => t.word === key)) assert.ok(c <= 3, `${f} year ${y + 1}: ${key} ends ${c} stage-${s + 1} names`)
        }
      }
      // most endings are different: many words and endings made for each species, not a short shared list
      assert.ok(counts[1]!.size >= 40 && counts[2]!.size >= 35, `${f} year ${y + 1}: ${counts[1]!.size} / ${counts[2]!.size} endings`)
    }
    // in the first year a built ending is made for one species, and comes back only when a root has nothing else
    const made = new Set([...builtEndings(f, 1), ...builtEndings(f, 2)])
    const built = new Map<string, number>()
    for (const { line } of yearOf(f, 0)) for (const n of line.slice(0, 2)) if (made.has(endingKey(n))) built.set(endingKey(n), (built.get(endingKey(n)) ?? 0) + 1)
    for (const [key, c] of built) assert.ok(c <= 4, `${f}: built ending ${key} used ${c} times in the first year`)
    assert.ok([...built.values()].filter(c => c === 1).length >= built.size * 0.6, `${f}: built endings repeat`)
  }
})

test('stage-2 and stage-3 endings keep enough of their source word to hear it, and no clip makes a word', () => {
  for (const f of FAMILIES) {
    for (const stage of [2, 3] as const) {
      for (const { word, tail } of sourceTails(f, stage)) {
        assert.match(word, /^[a-z]+$/, word)
        if (tail === word) continue
        // a late clip keeps the stressed syllable with its onset; an onset clip keeps the rest
        const late = !/^[aeiouy]/.test(tail)
        assert.ok(late || tail.length >= 5, `${word} -> ${tail}: a four-letter clip of a short word (tapir -> apir)`)
        assert.ok(tail.length / word.length >= 0.55, `${word} -> ${tail}: too little of the word survives`)
        assert.ok(!/(over|omen|arrow|aladin|ondor|orrent|inet|itten|oshawk|orvid|goyle|nado|turne|empest|errapin)/.test(tail), `${word} -> ${tail}`)
      }
    }
  }
  // words that clip into another word, a disease, a slur or a famous name, or that name a person or an object, are out
  const vocab = new Set(FAMILIES.flatMap(f => rootWords(f)))
  for (const w of 'kitten goshawk corvid gargoyle tornado nocturne terrapin tempest sultan ingot iron armor mortar ettin aura idol iris acorn auk tulip weasel kiln rumble purl mist alder cerberus oberon impala mistral oracle eclipse komodo tortoise capybara obsidian'.split(' ')) {
    if (w === 'tempest' || w === 'iron') continue // legendary first words, never clipped
    assert.ok(!sourceTails('haiku', 2).concat(...FAMILIES.flatMap(f => [sourceTails(f, 2), sourceTails(f, 3)])).some(t => t.word === w), `${w} is a source word`)
    assert.ok(!FAMILIES.some(f => familyRoots(f).regular.some(r => r.full === w)), `${w} is a root`)
  }
  assert.ok(vocab.size > 500, `only ${vocab.size} words`)
})

test('a season never repeats a root, a name or an ending source word', () => {
  for (let s = 1; s <= SEASONS; s++) {
    const season = seasons.filter(x => x.season === s)
    const names: string[] = []
    const roots: string[] = []
    const words = new Set<string>()
    for (const { family, index, line } of season) {
      const unique = [...new Set(line)]
      for (const n of unique) assert.ok(!isNearDuplicate(n, names), `season ${s}: ${n} near a taken name`)
      names.push(...unique)
      const root = index === 8 ? lower(nameStem(line[0])) : nameRoot(line[0])!
      assert.ok(!roots.includes(root), `season ${s}: root ${root} used twice (${family} ${line[0]})`)
      roots.push(root)
      if (index === 8) continue
      for (const n of line.slice(1)) {
        const w = endingSource(n)
        assert.ok(w, `${n}: no ending`)
        if (!sourceTails(family, 2).concat(sourceTails(family, 3)).some(t => t.word === w)) continue
        assert.ok(!words.has(w), `season ${s}: ${w} ends two names (${n})`)
        words.add(w)
      }
    }
  }
})

test('no name comes back within two years, and no season replays another', () => {
  const seen = new Map<string, number>()
  let late = 0
  for (const { season, line } of seasons) {
    for (const n of new Set(line)) {
      const was = seen.get(n)
      if (was !== undefined) {
        assert.ok(season - was >= 2 * YEAR, `${n} comes back in season ${season}, first seen in ${was}`)
        late++
      } else seen.set(n, season)
    }
  }
  assert.ok(late <= 60, `${late} names come back in the third year`)
  const byFamily = (s: number, f: Family) => seasons.filter(x => x.season === s && x.family === f && x.index < 8).map(x => x.line.join()).join('|')
  for (const f of FAMILIES) for (let s = 2; s <= SEASONS; s++) for (let t = 1; t < s; t++) assert.notEqual(byFamily(s, f), byFamily(t, f), `${f}: season ${s} replays ${t}`)
})

test('shortened roots are never words, pronouns or names of their own', () => {
  const bad = new Set('her gal mel gran grand kind bob bud pud run dun drag cat lil emm ott mag ash bon cor core neth net bas hob hobb smok pip kit bobb budd kitt pipp dipp tul rum weas kiln purl mist'.split(' '))
  for (const f of FAMILIES) {
    for (const { stem, full } of familyRoots(f).regular) {
      assert.ok(!bad.has(stem), `${f} ${full}: stem ${stem}`)
      if (stem === full) continue
      const why = blockReason(stem) ?? ''
      assert.ok(why !== `a first name: ${stem}` && why !== `plain word: ${stem}`, `${f} ${full}: stem ${stem} is ${why}`)
    }
  }
})

test('no two roots share a stem, within a family or across families', () => {
  // burr and burl, or linden and linnet, read as one root: a doubled close counts once (burr -> bur)
  const single = (s: string) => (s.length > 2 && s.at(-1) === s.at(-2) && !'aeiouylsf'.includes(s.at(-1)!) ? s.slice(0, -1) : s)
  const stems = FAMILIES.flatMap(f => [...familyRoots(f).regular.map(r => r.stem), ...familyRoots(f).legendary].map(s => ({ f, s: single(s) })))
  stems.forEach((a, i) => stems.forEach((b, j) => {
    if (i >= j) return
    const related = a.s === b.s || (a.s.length >= 3 && b.s.length >= 3 && (a.s.startsWith(b.s) || b.s.startsWith(a.s)))
    assert.ok(!related, `${a.f} ${a.s} and ${b.f} ${b.s}`)
  }))
})

test('same seed, same names; different seeds, different names', () => {
  for (const f of FAMILIES) {
    assert.deepEqual(speciesNames('spinlings/season/3/x/1', f), speciesNames('spinlings/season/3/x/1', f))
    assert.deepEqual(speciesNames('s/1', f, true, ['Mossip']), speciesNames('s/1', f, true, ['Mossip']))
  }
  assert.equal(mythicName('seed-a'), mythicName('seed-a'))
  assert.deepEqual(fusionLine('Mossnewt', 'Gloamyvern'), fusionLine('Mossnewt', 'Gloamyvern'))
  const distinct = new Set(lines.map(l => l.line.join()))
  assert.ok(distinct.size > lines.length * 0.95, `${lines.length - distinct.size} repeated lines`)
  assert.ok(new Set(mythics).size === mythics.length, 'mythic names repeat')
})

test('each family sounds more like itself than like the others', () => {
  for (const f of FAMILIES) {
    const own = lines.filter(l => l.family === f).map(l => l.line.join(''))
    const mean = (g: Family) => own.reduce((t, n) => t + familyFit(n, g), 0) / own.length
    for (const g of FAMILIES) if (g !== f) assert.ok(mean(f) > mean(g), `${f} names fit ${g} better`)
  }
})

test('legendaries: stately compounds of two whole words, no part twice within a year, no name twice for years', () => {
  const { firsts, crowns } = compoundWords()
  for (const f of FAMILIES) {
    const pool = legendaryNames(f)
    assert.ok(pool.length >= 78, `${f}: only ${pool.length} legendaries`)
    assert.equal(new Set(pool).size, pool.length, `${f} legendaries repeat`)
    for (const n of pool) { assertShape(n, LEGENDARY_SHAPE, 'legendary'); assertClean(n, 'legendary') }
    for (let i = 0; i < 5; i++) {
      const line = speciesNames(`test/${f}/legend/${i}`, f, true)
      assert.equal(new Set(line).size, 1, line.join())
    }
    const own = legends.filter(l => l.family === f).map(l => l.name)
    assert.equal(new Set(own).size, own.length, `${f}: 25 legendary seeds share names`)
    const year = seasons.filter(x => x.family === f && x.index === 8).map(x => lower(x.line[2]))
    assert.equal(new Set(year).size, year.length, `${f}: a legendary comes back within three years`)
    const first = (n: string) => firsts.find(w => n.startsWith(w))!
    const crown = (n: string) => crowns.find(w => n.endsWith(w) && first(n).length + w.length === n.length)!
    for (let k = 0; k < year.length; k++) {
      for (let j = Math.max(0, k - YEAR + 1); j < k; j++) {
        assert.notEqual(first(year[k]!), first(year[j]!), `${f}: ${year[j]} and ${year[k]} share a first word within a year`)
        assert.notEqual(crown(year[k]!), crown(year[j]!), `${f}: ${year[j]} and ${year[k]} share a second word within a year`)
      }
    }
  }
})

test('mythics are two pronounceable words from their own lists, never built like a legendary, never a place twice', () => {
  const legendary = new Set(FAMILIES.flatMap(f => legendaryNames(f)))
  const { firsts, crowns, places, beasts } = compoundWords()
  for (const w of [...places, ...beasts]) assert.ok(!crowns.includes(w), `${w} is also a legendary word`)
  for (const m of mythics) {
    const parts = m.split(' ')
    assert.equal(parts.length, 2, m)
    for (const p of parts) {
      assertShape(p, MYTHIC_WORD_SHAPE, 'mythic word')
      assert.ok(!legendary.has(p), `${m} copies a legendary`)
      assert.ok(!firsts.some(w => lower(p).startsWith(w)), `${m}: ${p} opens with a legendary word`)
      assert.ok(!crowns.some(w => lower(p).endsWith(w)), `${m}: ${p} closes with a legendary word`)
      assert.doesNotMatch(lower(p), /[bcdgkpt]owl/, `${m}: owl after a stop`)
    }
    assert.ok(places.some(w => lower(parts[0]!).endsWith(w)), `${m}: the first word is not a place`)
    assert.ok(beasts.some(w => lower(parts[1]!).endsWith(w)), `${m}: the second word is not a creature`)
    assert.notEqual(nameStem(parts[0]!), nameStem(parts[1]!), `${m} repeats its root`)
    assert.doesNotMatch(lower(parts[0]!), /^(mire|marsh|bog|fen)(mere|fen|mire|marsh|brook)$/, `${m}: a marsh twice`)
  }
})

test('every seed names a Mythic, and a season that holds every name still names its species', () => {
  // a seed whose early picks were all unusable used to throw (test/mythic/830 among them)
  for (let i = 0; i < 10000; i++) {
    const m = mythicName(`test/mythic/${i}`)
    const parts = m.split(' ')
    assert.equal(parts.length, 2, m)
    for (const p of parts) { assertClean(p, `mythic ${i}`); assertShape(p, MYTHIC_WORD_SHAPE, `mythic ${i}`) }
    assert.ok(!isBlocked(m), m)
  }
  assert.equal(mythicNameFor('test/mythic/830'), mythicName('test/mythic/830'))
  for (const f of FAMILIES) {
    const [name] = speciesNames('spinlings/season/2/x/8', f, true, legendaryNames(f))
    assert.ok(legendaryNames(f).includes(name), `${f}: ${name}`)
  }
  const line = speciesNames('spinlings/season/5/opus/3', 'opus', false, allSpecies)
  line.forEach((n, i) => { assertClean(n, 'crowded season'); assertShape(n, STAGE_SHAPE[(i + 1) as Stage], 'crowded season') })
})

test('fusions keep both parents: A\'s root up front, B heard at every stage, never a species name', () => {
  const rimeOf = (w: string) => w.replace(/^[^aeiouy]+/, '')
  const heard = [0, 0, 0]
  for (const { a, b, line } of fusions) {
    line.forEach((n, i) => assertShape(n, STAGE_SHAPE[(i + 1) as Stage], `fusion stage ${i + 1}`))
    const label = `${a} + ${b} -> ${line.join(' / ')}`
    const root = lower(line[0]).slice(0, 3)
    assert.ok(lower(a).startsWith(root), `${label} lost A's root`)
    for (const n of line) {
      assert.ok(!isNearDuplicate(n, [a, b]), `${label} copies a parent`)
      assert.ok(lower(n).startsWith(root), `${label} changes root`)
      assert.ok(!allSpecies.has(n) && !isSpeciesName(n), `${label}: ${n} is a species name`)
    }
    const [x, y, z] = line.map(lower) as [string, string, string]
    assert.ok(y.length > x.length && z.length > y.length && syllables(z) > syllables(x), `${label} does not grow`)
    const season = seasonNames.find(ns => ns.includes(a))!
    for (let s = 1; s <= 3; s++) assert.equal(fusionName(a, b, s as Stage, season), line[s - 1])
    // B's sound: its root word's first vowel and the letter after it (jasper -> as, rill -> il)
    const echo = rimeOf((nameRoot(b) ?? lower(b)).slice(0, 4)).slice(0, 2)
    line.forEach((n, i) => { if (lower(n).slice(2).includes(echo)) heard[i]!++ })
    // a season's names are taken: a fusion never lands near one of them
    for (const n of line) assert.ok(!isNearDuplicate(n, season.filter(t => t !== a && t !== b)), `${label}: ${n} is a season name`)
  }
  for (const s of [1, 2]) assert.ok(heard[s]! >= fusions.length * 0.5, `B is heard at stage ${s + 1} in only ${heard[s]} of ${fusions.length}`)
  assert.ok(heard[0]! >= fusions.length * 0.4, `B is heard at stage 1 in only ${heard[0]} of ${fusions.length}`)
  // the classic pairing from the spec still reads as both parents
  const [one, two, three] = fusionLine('Mothyn', 'Jaspabon')
  assert.match(one, /^Moth/)
  assert.match(two.toLowerCase(), /^mothasp/)
  assert.match(three.toLowerCase(), /^moth.*as/)
})

test('any two names fuse: 5,000 random pairs of every kind give a clean, growing line, never a throw', () => {
  const rng = rngFromSeed('test/fusion/any-pair')
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!
  // promos are whatever an admin types that the schema allows (SPEC section 25), so some no root opens
  const promos = ['Founder', 'Founder II', 'Goldie', 'Sparkle', 'Emberlight', 'Nightingale', 'Captainmarvelous', 'Pip', 'Ia',
    'Eerie', 'Oolong', 'Strengths', 'Xyzzy', 'Qwerty', 'Aeiou', 'Brr', 'Tsk', 'Oyo']
  // and any letters at all
  const any: string[] = []
  while (any.length < 300) {
    const n = Array.from({ length: 3 + Math.floor(rng() * 9) }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)]).join('')
    if (!isBlocked(n)) any.push(n[0]!.toUpperCase() + n.slice(1))
  }
  // names minted before this generator: prefix + suffix names, and the blends the old fallback gave
  const old = ['Pipkin', 'Fogmaw', 'Brasslord', 'Mossling', 'Quillcolossus', 'Thornregent', 'Gloamsprout', 'Netheink',
    'Nethebeast', 'Nethemonarch', 'Briarlute', 'Briarsage', 'Nightimol']
  const made: string[] = fusions.flatMap(f => f.line)
  const legendary = FAMILIES.flatMap(f => legendaryNames(f))
  const mythic = Array.from({ length: 600 }, (_, i) => mythicName(`test/fusion/mythic/${i}`))
  const kinds: Record<string, () => string> = {
    species: () => pick(pick(regular).line),
    legendary: () => pick(legendary),
    mythic: () => pick(mythic),
    promo: () => pick(promos),
    any: () => pick(any),
    old: () => pick(old),
    fusion: () => pick(made),
  }
  const names = Object.keys(kinds)
  const pairings = new Set<string>()
  for (let i = 0; i < 5000; i++) {
    const [ka, kb] = [pick(names), pick(names)]
    const a = kinds[ka]!()
    const b = kinds[kb]!()
    const taken = rng() < 0.5 ? pick(seasonNames) : []
    const label = `${a} (${ka}) + ${b} (${kb})${taken.length ? ' in a season' : ''}`
    let line: Line
    try {
      line = fusionLine(a, b, taken)
    } catch (e) {
      assert.fail(`${label} throws: ${(e as Error).message}`)
    }
    assert.deepEqual(fusionNameLine(a, b, taken), line, `${label}: the seam sends a name back`)
    const full = `${label} -> ${line.join(' / ')}`
    line.forEach((n, s) => {
      assertClean(n, full)
      assertShape(n, STAGE_SHAPE[(s + 1) as Stage], full)
      assert.ok(!isBlocked(n), `${full}: ${n} is blocked`)
      assert.ok(!isSpeciesName(n), `${full}: ${n} is a species name`)
      assert.ok(!isNearDuplicate(n, [a, b, ...a.split(' '), ...b.split(' ')]), `${full}: ${n} copies a parent`)
      assert.ok(!isNearDuplicate(n, taken), `${full}: ${n} is a season name`)
    })
    const [x, y, z] = line.map(lower) as [string, string, string]
    assert.ok(y.length > x.length && z.length > y.length && syllables(z) > syllables(x), `${full} does not grow`)
    // a parent a generator named keeps its opening (Net- for Netherhowl, Br- for Briarvale); a fusion may descend
    // from letters no root opens
    if (!['promo', 'any', 'fusion'].includes(ka)) assert.equal(x.slice(0, 2), lower(a).slice(0, 2), `${full} loses A's opening`)
    made.push(pick(line))
    pairings.add(`${ka}+${kb}`)
  }
  assert.equal(pairings.size, names.length ** 2, 'every pairing of kinds is tried')
  // the pairs the generator could not blend before: a legendary whose stem opens a word, a Mythic whose stem ends in
  // a vowel
  assert.deepEqual(fusionLine('Netherhowl', 'Figmink').map(n => n.slice(0, 3)), ['Net', 'Net', 'Net'])
  assert.ok(fusionLine('Briarvale Snowpaw', 'Foamlute').every(n => n.startsWith('Br')))
})

test('the generator\'s blocklists hold every word of the seam\'s, so the seam never sends a name back', () => {
  for (const w of BLOCKED_WORDS) {
    for (const n of [w, `mos${w}`, `${w}el`, `mos${w}el`, `Fern ${w}`]) assert.notEqual(blockReason(n), null, n)
  }
})

test('junctions read one way only', () => {
  // an e after one short vowel and one consonant: cate-foil or cat-e-foil?
  assert.deepEqual(junctions('cat', 'efoil'), [])
  // a vowel pair or -oar root before a vowel: dew + ith reads "you with", boar + o and aur + ee blur
  assert.deepEqual(junctions('dew', 'ith'), [])
  assert.deepEqual(junctions('boar', 'o'), [])
  // a silent-e root swallows its e before a vowel and loses its sound (tid-olcano)
  assert.deepEqual(junctions('tide', 'olcano'), [])
  // an owl after a stop splits the wrong way (kel-powl)
  assert.deepEqual(junctions('kelp', 'owl'), [])
  // an overlap never splits a digraph: myth + hound would read my-thound
  assert.ok(!junctions('myth', 'hound', 'hound').includes('mythound'))
  // overlaps keep the whole word: moor + raven, leaf + finch
  assert.deepEqual(junctions('moor', 'raven', 'raven', true), ['mooraven'])
  assert.ok(junctions('leaf', 'finch', 'finch').includes('leafinch'))
  assert.ok(junctions('shoal', 'elody').includes('shoalelody'))
  assert.ok(junctions('glow', 'isper').includes('glowisper'))
  assert.ok(junctions('fog', 'o').includes('foggo'))
  // a long ending carries the stress, so a short root does not double before it (twig + iskin)
  assert.deepEqual(junctions('twig', 'iskin'), ['twigiskin'])
  assert.ok(junctions('chirp', 'pip', 'pip').includes('chirpip'))
})

test('the scorer: sayable names score high, broken spellings and stutters score low', () => {
  for (const good of ['Pipkin', 'Fogmaw', 'Hollowmere', 'Mossip', 'Thornel', 'Dewella', 'Brookalune', 'Cragodon', 'Mothorgon', 'Cobbastodon', 'Thundolcano', 'Mooraven', 'Peakraken', 'Leafinch', 'Mossnewt', 'Verserenade', 'Glowyvern']) {
    assert.equal(phonotactics(good), null, good)
    assert.ok(pronounceability(good) >= 0.75, `${good}: ${pronounceability(good)}`)
  }
  for (const bad of ['Strngth', 'Bramble', 'Xkqzt', 'Aeiou', 'Mossstep', 'Ngorp', 'Phlox', 'Qat', 'Duskwing', 'Bdel']) {
    assert.equal(pronounceability(bad), 0, bad)
    assert.notEqual(phonotactics(bad), null, bad)
  }
  // repeated syllables are never names
  for (const stutter of ['Lalala', 'Yororrow', 'Lororess', 'Roworrow', 'Dunoror', 'Pippilil', 'Cragaga']) {
    assert.equal(pronounceability(stutter), 0, stutter)
  }
  // a rhyme said twice, an ending that reads more than one way, or a hard -rl / -lm close falls below the bar
  for (const weak of ['Gongag', 'Gongog', 'Gullil', 'Gullel', 'Sealteal', 'Gongingot', 'Lyrirrus', 'Owlyr', 'Glowyr', 'Gullarl', 'Foggurl', 'Mistarl', 'Minelm', 'Riddelm']) {
    assert.ok(pronounceability(weak) < MIN_SCORE, `${weak}: ${pronounceability(weak)}`)
  }
  // softer faults lower the score without ruling the name out
  assert.ok(pronounceability('Gimel') < pronounceability('Bimel'), 'soft g reads two ways')
  assert.ok(pronounceability('Loroyane') < pronounceability('Lorolane'), 'glide between vowels')
  assert.ok(pronounceability('Beanewt') < pronounceability('Beanib'), 'a vowel pair, a consonant and -ew')
  assert.equal(syllables('Pebble'), 2)
  assert.equal(syllables('Runeth'), 2)
  assert.equal(syllables('Thorne'), 1)
  assert.equal(syllables('Lyria'), 3)
})

test('blocklists: rude, drug, developer and internet words, franchises, phrases, sound-alikes, people and plain English', () => {
  const blocked = [
    'Shitwick', 'Fernbutt', 'Assel', 'Pixelmaw', 'Bytewing', 'Codelet', 'Debugrin', 'Gitmoss',
    'Pikachoo', 'Bulbasar', 'Charmandel', 'Eeveel', 'Gengor', 'Mossmon', 'Fernchu', 'Thornsaur', 'Dewgonk',
    'Ribbon', 'Mellow', 'Willow', 'Mossy', 'Twiggy', 'Lentill', 'Titanor', 'Pussel',
    // drugs, rude and silly words inside a name
    'Beanimeth', 'Croonoral', 'Heragoon', 'Weasick', 'Daisimess', 'Glidalole', 'Puddin', 'Smokinotaur', 'Motherebus',
    'Grandadum', 'Trollmaw', 'Lilit', 'Lilim', 'Fogimp',
    // developer and internet words
    'Newtinet', 'Runet', 'Basick', 'Basaline', 'Corelis', 'Bullog', 'Shalog', 'Tidorrent', 'Silvorrent', 'Tulkit',
    // famous names hidden inside a name, even one letter off
    'Magondor', 'Mammondor', 'Gravaladin', 'Riversong', 'Flicky', 'Drizzy', 'Fernet', 'Pippinnow', 'Granok', 'Granock',
    'Elfen', 'Fenix', 'Goyle',
    // phrases, people and sound-alikes
    'Reedover', 'Pearlover', 'Herlow', 'Brewit', 'Yewith', 'Hazit', 'Caty', 'Emmie', 'Corin', 'Willen', 'Rubbar',
    'Hummane', 'Coalombat', 'Bobbill', 'Melil', 'Ottow', 'Hobyn', 'Dragud', 'Sleetand', 'Cloakin', 'Plummit',
    'Hornot', 'Peakan', 'Drumur', 'Cornur',
    // stock endings and bad joins
    'Bullug', 'Charmum', 'Rillee', 'Rookick', 'Granadond', 'Catefoil', 'Cateline', 'Dillefoil', 'Kelpowl', 'Wandowl',
    'Dewgoblin', 'Baserbena', 'Cairnubag', 'Bisogod',
    // a word heard across the join
    'Elmitten', 'Owladder', 'Gulletrel', 'Mintallaby', 'Crownix',
  ]
  for (const n of blocked) assert.ok(blockReason(n) !== null || pronounceability(n) === 0, n)
  for (const ok of ['Mossip', 'Brassagon', 'Glowyvern', 'Hollowmere', 'Brassel', 'Mooraven', 'Thundolcano', 'Cobbastodon', 'Rivertide', 'Anvilmaw', 'Vesperwyrm', 'Swirlowl', 'Moonwick', 'Rookimp', 'Leafinch', 'Peakraken', 'Mossnewt']) {
    assert.equal(blockReason(ok), null, ok)
  }
})

test('near-duplicates are edit distance 1, case-insensitive', () => {
  assert.equal(editDistance('mossip', 'mossip'), 0)
  assert.equal(editDistance('mossip', 'mossap'), 1)
  assert.equal(editDistance('mossip', 'mosip'), 1)
  assert.equal(editDistance('kitten', 'sitting'), 3)
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3)
  assert.ok(isNearDuplicate('Mossip', ['MOSSAP']))
  assert.ok(!isNearDuplicate('Mossip', ['Mossalin', 'Fernip']))
  // the quick one-edit check agrees with the full distance
  const rng = rngFromSeed('test/near-duplicates')
  const word = () => Array.from({ length: Math.floor(rng() * 7) }, () => 'abcab'[Math.floor(rng() * 5)]).join('')
  for (let i = 0; i < 20000; i++) {
    const [a, b] = [word(), word()]
    assert.equal(isNearDuplicate(a, [b]), editDistance(a, b) <= 1, `${a} / ${b}`)
  }
})

test('root pools are plain nature and whimsy words: no rude, developer or franchise words', () => {
  for (const f of FAMILIES) {
    const words = rootWords(f)
    assert.ok(words.length >= 100, `${f}: only ${words.length} source words`)
    assert.ok(smallWords(f).length >= 13, `${f}: only ${smallWords(f).length} small words`)
    assert.ok(sourceTails(f, 2).length >= 24 && sourceTails(f, 3).length >= 42, `${f}: too few stage-2 or stage-3 words`)
    for (const w of words) {
      assert.match(w, /^[a-z]+$/, w)
      // a source word is a plain word by definition and never stands alone, so only edge rules (brass ends in
      // "ass"), stock endings and near misses (dew and mew) may touch it; never a rude, developer or franchise word
      const why = blockReason(w) ?? ''
      const near = /^too close to (\w+)$/.exec(why)
      const fine = why === '' || /plain word|at an edge|at the end|stock ending|first name|sounds like|opens with|phrase|unclear e|holds the word|reads as/.test(why) || (near && near[1] !== w)
      assert.ok(fine, `${f} source word ${w}: ${why}`)
    }
  }
})

test('the generator is pure: no Math.random, no Date', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = (await readFile(new URL('../../plugin/hooks/core/names.ts', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/Math\.random|Date\.|new Date|process\.|require\(|from 'node:/.test(src))
  assert.match(src, /from '\.\/rng\.ts'/)
})

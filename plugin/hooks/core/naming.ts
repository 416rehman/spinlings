// The one seam between the rules and the name generator (SPEC section 23): species, fusion and Mythic names come
// from core/names.ts, and this file's blocklist has the last word on each. A blocked name goes back as taken (or a
// Mythic re-seeds) for another try. A generator that cannot name a species or a Mythic throws, so a broken season fails
// loudly before it is frozen; only a fusion falls back to the old prefix + stage-suffix blend, because the generator
// cannot blend some legendary and Mythic parents. Nothing else in the core makes a creature name.
import type { Family } from './types.ts'
import { fusionLine, mythicName, speciesNames } from './names.ts'
import { hashString, int, rngFromSeed } from './rng.ts'

export type NameLine = [string, string, string]

const SUFFIXES: readonly (readonly string[])[] = [
  ['let', 'kin', 'bit', 'ling', 'pup', 'nib', 'sprout', 'bun'],
  ['maw', 'horn', 'wing', 'tail', 'fang', 'crest', 'beast', 'paw'],
  ['lord', 'titan', 'regent', 'sage', 'giant', 'monarch', 'colossus', 'elder'],
]
const TRAINER_FRONTS = ['Thistle', 'Bramble', 'Moss', 'Fern', 'Pebble', 'Clover', 'Hazel', 'Rowan', 'Juniper', 'Bracken', 'Sorrel', 'Tansy', 'Willow', 'Briar', 'Heather', 'Nettle']
const TRAINER_ENDS = ['wick', 'worth', 'by', 'ton', 'more', 'field', 'brook', 'dale', 'hollow', 'thorne', 'bury', 'ford']

// Lowercase substrings no generated name may contain: rude words and other people's creatures.
const BLOCKLIST: readonly string[] = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'piss', 'slut', 'whore', 'twat', 'wank', 'tits', 'porn', 'rape',
  'nazi', 'fag', 'nigg', 'anus', 'penis', 'vagin', 'boob', 'butt', 'poop', 'turd', 'damn', 'hell',
  'pikachu', 'pokemon', 'digimon', 'eevee', 'mewtwo', 'snorlax', 'gengar', 'jigglypuff', 'charizard', 'bulbasaur',
  'squirtle', 'mario', 'luigi', 'zelda', 'kirby', 'yoshi', 'sonic', 'totoro', 'groot', 'yoda', 'grogu', 'shrek',
  'stitch', 'elmo', 'simba', 'nemo', 'gollum', 'smaug', 'hobbit', 'godzilla', 'mothra', 'gundam', 'inkling',
  'twiglet', 'furby', 'tamagotchi', 'moomin', 'pusheen', 'gremlin', 'muppet', 'smurf', 'minion', 'ewok', 'wookie',
]

/** True for names we never use: rude words, other people's creatures, or three of a letter in a row. */
export function isBlocked(name: string): boolean {
  const n = name.toLowerCase()
  return /(.)\1\1/.test(n) || BLOCKLIST.some(w => n.includes(w))
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
const lower = (names: Iterable<string>) => new Set([...names].map(n => n.toLowerCase()))

/**
 * The three stage names of a species from its seed (`spinlings/season/{season}/{family}/{index}`). Legendaries never
 * evolve: their one name fills all three entries. `taken` holds the season's names so far; none is reused.
 */
export function speciesNameLine(seed: string, family: Family, legendary: boolean, taken: Iterable<string>): NameLine {
  const t = [...taken]
  return clean(t, () => speciesNames(seed, family, legendary, t))
}

/** The generator's line, retried with any blocked name marked taken. Throws when every try is blocked. */
function clean(taken: string[], make: () => NameLine): NameLine {
  for (let i = 0; i < 4; i++) {
    const line = make()
    const bad = line.filter(isBlocked)
    if (!bad.length) return line
    taken.push(...bad)
  }
  throw new Error('every name the generator offered is blocked')
}

const ALL_SUFFIXES = SUFFIXES.flat().sort((a, b) => b.length - a.length)

/** Splits a name into its front and its stage suffix, e.g. Fogmaw -> Fog + maw; odd names split in half. */
function splitName(name: string): [string, string] {
  const base = name.split(' ')[0]!
  const low = base.toLowerCase()
  for (const s of ALL_SUFFIXES) if (low.endsWith(s) && base.length - s.length >= 3) return [base.slice(0, base.length - s.length), s]
  const cut = Math.ceil(base.length / 2)
  return [base.slice(0, cut), base.slice(cut).toLowerCase()]
}

/**
 * A fusion's three names, blending A's root with B's. Same parents, same names. The generator cannot blend some
 * legendary and Mythic parents (about 1 pair in 160); those get the old blend of A's front and B's stage ending.
 */
export function fusionNameLine(nameA: string, nameB: string, taken: Iterable<string>): NameLine {
  const base = [...taken], t = [...base]
  try {
    return clean(t, () => fusionLine(nameA, nameB, t))
  } catch {
    return classicFusion(nameA, nameB, base)
  }
}

/** A's front with B's ending at its own stage, grown through the other stages. */
function classicFusion(nameA: string, nameB: string, taken: Iterable<string>): NameLine {
  const used = lower(taken)
  const [front] = splitName(nameA)
  const [, back] = splitName(nameB)
  const own = Math.max(0, SUFFIXES.findIndex(list => list.includes(back)))
  const h = hashString(`fusion/${nameA}/${nameB}`)
  const out: string[] = []
  for (let stage = 0; stage < 3; stage++) {
    const list = SUFFIXES[stage]!
    const end = stage === own ? back : list[(h >>> (stage * 8)) % list.length]!
    let name = ''
    for (const v of ['', 'a', 'o', 'i', 'e', 'u', 'oo']) {
      name = title(front + v + end)
      if (!used.has(name.toLowerCase()) && !isBlocked(name) && !out.includes(name)) break
    }
    out.push(name)
  }
  return out as NameLine
}

/** A Mythic's two-word name, e.g. "Embermere Shadowmoth": a place and a creature, from its own seed, re-seeded when blocked. */
export function mythicNameFor(seed: string): string {
  for (let i = 0; i < 8; i++) {
    const name = mythicName(i ? `${seed}/${i}` : seed)
    if (!isBlocked(name)) return name
  }
  throw new Error(`every Mythic name for ${seed} is blocked`)
}

/** A Rival trainer's name, e.g. Thistlewick (the UI always says "Rival Thistlewick"). */
export function rivalName(seed: string): string {
  const rng = rngFromSeed('spinlings/rival-name/' + seed)
  for (;;) {
    const name = TRAINER_FRONTS[int(rng, TRAINER_FRONTS.length)]! + TRAINER_ENDS[int(rng, TRAINER_ENDS.length)]!
    if (!isBlocked(name)) return name
  }
}

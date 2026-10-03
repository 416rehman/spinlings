// The one seam between the rules and the name generator (SPEC section 23): species, fusion and Mythic names come
// from core/names.ts, and this file's blocklist has the last word on each. A blocked name goes back as taken (or a
// Mythic re-seeds) for another try. The generator names any seed and fuses any two names, and its own blocklists hold
// every word of this one (a test pins it), so no name it offers is ever sent back. Nothing else in the core makes a
// creature name.
import type { Family } from './types.ts'
import { fusionLine, mythicName, speciesNames } from './names.ts'
import { int, rngFromSeed } from './rng.ts'

export type NameLine = [string, string, string]

const TRAINER_FRONTS = ['Thistle', 'Bramble', 'Moss', 'Fern', 'Pebble', 'Clover', 'Hazel', 'Rowan', 'Juniper', 'Bracken', 'Sorrel', 'Tansy', 'Willow', 'Briar', 'Heather', 'Nettle']
const TRAINER_ENDS = ['wick', 'worth', 'by', 'ton', 'more', 'field', 'brook', 'dale', 'hollow', 'thorne', 'bury', 'ford']

/** Lowercase substrings no generated name may contain: rude words and other people's creatures. */
export const BLOCKED_WORDS: readonly string[] = [
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
  return /(.)\1\1/.test(n) || BLOCKED_WORDS.some(w => n.includes(w))
}

/**
 * The three stage names of a species from its seed (`spinlings/season/{season}/{family}/{index}`). Legendaries never
 * evolve: their one name fills all three entries. `taken` holds the season's names so far; none is reused.
 */
export function speciesNameLine(seed: string, family: Family, legendary: boolean, taken: Iterable<string>): NameLine {
  const t = [...taken]
  return clean(t, () => speciesNames(seed, family, legendary, t))
}

/**
 * The generator's line, retried with any blocked name marked taken. It throws only if the generator's blocklists stop
 * holding this one's, which a test rules out.
 */
function clean(taken: string[], make: () => NameLine): NameLine {
  for (let i = 0; i < 4; i++) {
    const line = make()
    const bad = line.filter(isBlocked)
    if (!bad.length) return line
    taken.push(...bad)
  }
  throw new Error('every name the generator offered is blocked')
}

/**
 * A fusion's three names, A's root up front and B heard after it. Same parents, same names. Any two names fuse,
 * legendaries, Mythics, promos and fusions included.
 */
export function fusionNameLine(nameA: string, nameB: string, taken: Iterable<string>): NameLine {
  const t = [...taken]
  return clean(t, () => fusionLine(nameA, nameB, t))
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

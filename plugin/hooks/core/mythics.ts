// Mythics (SPEC section 18): one-of-a-kind creatures generated at the moment of the encounter from a fresh seed.
// Each carries its own embedded form, like a fusion: its parts, palette, name and stats all come from that seed.
import type { Accessory, CardForm, CardOrigin, NewCard } from './types.ts'
import { ECONOMY } from './economy.ts'
import { mintBase } from './cards.ts'
import { FAMILIES, hueAt } from './families.ts'
import { mythicNameFor } from './naming.ts'
import { pick, rngFromSeed } from './rng.ts'
import { BODIES, PATTERNS, baseStats, statJitter } from './species.ts'
import { seasonOf } from './world.ts'

/** Mythics keep only a wings or spikes accessory and always float a halo (the sprite draws it). */
const MYTHIC_ACCESSORIES: readonly Accessory[] = ['halo', 'wings', 'spikes']

/** A Mythic's form from its seed: a random family's palette, its own body and name, and 1.1x the legendary base. */
export function mythicForm(seed: string): CardForm {
  const rng = rngFromSeed('spinlings/mythic/' + seed)
  const family = pick(rng, FAMILIES)
  const body = pick(rng, BODIES)
  const hue = Math.round(hueAt(family, rng()))
  const pattern = pick(rng, PATTERNS)
  const accessory = pick(rng, MYTHIC_ACCESSORIES)
  const base = baseStats(family, statJitter(rng), ECONOMY.stats.legendaryBase * ECONOMY.stats.mythicBase)
  const name = mythicNameFor(seed)
  return { kind: 'mythic', family, body, hue, pattern, accessory, base, names: [name, name, name], legendary: true, seed }
}

export type MythicOptions = { seed: string; dna: number; now: number; level?: number; shiny?: boolean; origin?: CardOrigin }

/** A Mythic card: species 'mythic', legendary rarity, always foil, in its final form (stage 3). */
export function generateMythic(o: MythicOptions): NewCard {
  const form = mythicForm(o.seed)
  return mintBase({
    species: 'mythic', form, season: seasonOf(o.now), family: form.family, legendary: true, rarity: 'legendary',
    shiny: o.shiny ?? false, dna: o.dna, origin: o.origin ?? 'catch', now: o.now, level: o.level ?? 1, foil: true,
  })
}

/** A fresh Mythic seed drawn from an Rng (the server's is crypto-backed). */
export function mythicSeed(rng: () => number): string {
  let s = ''
  for (let i = 0; i < 16; i++) s += 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(rng() * 32)]
  return s
}

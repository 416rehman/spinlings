// Drops (SPEC section 25): promo codes that give everyone the same limited creature, hatched with personal DNA.
// The drop itself is a D1 row; this is the pure part: code normalising, the promo form and minting the reward.
import type { CardForm, DropReward, DropRewardItem, Family, NewCard, PromoEgg, Rng } from './types.ts'
import { ECONOMY } from './economy.ts'
import { mintBase } from './cards.ts'
import { FAMILIES, hueAt } from './families.ts'
import { pick, rngFromSeed, uint32 } from './rng.ts'
import { ACCESSORIES, BODIES, PATTERNS, baseStats, statJitter } from './species.ts'
import { mintFor } from './trader.ts'
import { seasonOf } from './world.ts'

/** Codes compare upper-cased with dashes and spaces removed: `golden-7q2m-k9xd` is `GOLDEN7Q2MK9XD`. */
export function normalizeDropCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, '')
}

/** The promo creature's form: parts, hue, pattern and stats from its seed; name, family and stamp as given. */
export function promoForm(promo: PromoEgg): CardForm {
  const rng = rngFromSeed('spinlings/promo/' + promo.seed)
  const legendary = promo.rarity === 'legendary'
  return {
    kind: 'promo',
    family: promo.family,
    body: pick(rng, BODIES),
    hue: Math.round(hueAt(promo.family, 0.08 + 0.84 * rng())),
    pattern: pick(rng, PATTERNS),
    accessory: pick(rng, ACCESSORIES),
    base: baseStats(promo.family, statJitter(rng), legendary ? ECONOMY.stats.legendaryBase : 1),
    names: [promo.name, promo.name, promo.name],
    legendary,
    seed: promo.seed,
    stamp: promo.stamp,
  }
}

/** One redeemer's copy of a promo egg: the drop's form with this player's DNA. Public drops are bound. */
export function promoCard(promo: PromoEgg, dna: number, now: number, bound = true): NewCard {
  const form = promoForm(promo)
  return mintBase({
    species: 'promo', form, season: seasonOf(now), family: promo.family, legendary: form.legendary, rarity: promo.rarity,
    shiny: false, dna, origin: 'promo', now, foil: promo.foil, bound,
  })
}

export function dropItems(reward: DropReward): DropRewardItem[] {
  return Array.isArray(reward) ? reward : [reward]
}

/** Everything a redemption mints: cards, and the families of the packs for the server to create. */
export function mintDropReward(reward: DropReward, rng: Rng, now: number, bound: boolean): { cards: NewCard[]; packs: Family[] } {
  const cards: NewCard[] = []
  const packs: Family[] = []
  for (const item of dropItems(reward)) {
    if (item.type === 'egg') cards.push(promoCard(item.promo, uint32(rng), now, bound))
    else if (item.type === 'pack') for (let i = 0; i < item.count; i++) packs.push(item.family ?? pick(rng, FAMILIES))
    else cards.push(mintFor(item.family ?? pick(rng, FAMILIES), item.rarity, rng, now, 'promo', bound))
  }
  return { cards, packs }
}

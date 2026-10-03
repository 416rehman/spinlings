// The market's shared rules (SPEC 8): what a listing asks for and which cards answer it. The server decides every
// sale with these; the mod uses them to show which of its cards fit a listing.
import type { ListingKind, MarketWant } from './api.ts'
import { rarityRank } from './cards.ts'
import type { BattleCard } from './types.ts'

/** A listing's kind, from its terms: sparks only, a card only, or both. */
export function listingKind(price: number, want: MarketWant | undefined): ListingKind {
  return want ? (price > 0 ? 'both' : 'swap') : 'sparks'
}

/** Why a want cannot be listed, or null when it can. */
export function wantProblem(w: MarketWant): string | null {
  if (w.species === undefined && w.family === undefined && w.rarity === undefined && !w.shiny && !w.foil) return 'say what card you want'
  if (w.species !== undefined && w.family !== undefined) return 'a species already names its family'
  return null
}

/** The card answers the want: the species (or family), at least the rarity, and shiny or foil when asked. */
export function wantMatches(w: MarketWant, c: Pick<BattleCard, 'species' | 'family' | 'rarity' | 'shiny' | 'foil'>): boolean {
  if (w.species !== undefined && c.species !== w.species) return false
  if (w.family !== undefined && c.family !== w.family) return false
  if (w.rarity !== undefined && rarityRank(c.rarity) < rarityRank(w.rarity)) return false
  if (w.shiny && !c.shiny) return false
  if (w.foil && c.foil !== true) return false
  return true
}

// Shared builders for the core tests.
import type { BattleCard, Card, Family, Rarity, Species, TraitId } from '../../plugin/hooks/core/types.ts'
import { cardStats, mintCard, stageFor } from '../../plugin/hooks/core/cards.ts'
import { familySpecies, isFinalForm } from '../../plugin/hooks/core/species.ts'
import { EPOCH_MS } from '../../plugin/hooks/core/world.ts'

export const NOW = EPOCH_MS + 3 * 86_400_000 + 3_600_000

export function speciesOf(family: Family, index = 0, season = 1): Species {
  return familySpecies(season, family)[index]!
}

/** A card; any override of a stat input recomputes its stats, so they never go stale. */
export function card(species: Species, over: Partial<Card> = {}, dna = 7, rarity: Rarity = species.legendary ? 'legendary' : 'common'): Card {
  const c: Card = { ...mintCard({ species, rarity, shiny: false, dna, origin: 'pack', now: NOW }), id: 'c' + dna, ...over }
  return over.stats ? c : { ...c, stats: cardStats(c) }
}

/** The same card at another level, with its stage and stats to match. */
export function atLevel<T extends BattleCard>(c: T, level: number): T {
  const out = { ...c, level, stage: isFinalForm(c) ? 3 : stageFor(level) }
  return { ...out, stats: cardStats(out) }
}

/**
 * A battle card with chosen traits, genes and level, so effects can be isolated. It carries no stats, so the
 * simulator computes them from whatever the test spreads over it.
 */
export function fighter(family: Family, over: Partial<BattleCard> & { traits?: TraitId[] } = {}, index = 0): BattleCard {
  const s = speciesOf(family, index)
  const c = card(s)
  return {
    id: over.id ?? `${family}-${index}`, species: s.id, season: 1, family, rarity: 'common', shiny: false, dna: c.dna,
    genes: [8, 8, 8, 8], traits: ['swift'], level: 5, stage: 1, ...over,
  } as BattleCard
}

/** Mean and a tolerance band check for observed frequencies: |p - expected| <= k standard errors. */
export function near(observed: number, n: number, expected: number, k = 5): boolean {
  const se = Math.sqrt((expected * (1 - expected)) / n)
  return Math.abs(observed / n - expected) <= k * se + 1e-9
}

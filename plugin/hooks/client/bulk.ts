// Opening every waiting pack at once (SPEC 13.5): ten packs to a request, the best pulls with their own beats (rising,
// so the top pull plays last), then every card grouped by rarity, identical pulls stacked. Pure.
import { OPEN_PACKS_MAX } from '../core/api.ts'
import type { Card } from '../core/types.ts'
import { rarityRank } from '../core/cards.ts'
import { dots, plural } from './text.ts'
import type { Reveal } from './types.ts'

/** Packs per openPacks request. */
export const CHUNK = OPEN_PACKS_MAX
/** At most this many best pulls get their own beat, so fifty packs still take seconds, not minutes. */
export const BEST_MAX = 5
/** What a new species adds to its card's score, in the reveal's order and the summary's alike. */
const NEW_SPECIES_BONUS = 5

type Pull = Pick<Card, 'species' | 'rarity' | 'shiny' | 'foil' | 'firstFind'>

const isMythic = (c: Pick<Card, 'species'>) => c.species === 'mythic'

export function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

/** Legendary over epic over rare; then a Mythic, a first find, foil and Alt colour add to it. */
function baseScore(c: Pull): number {
  return (isMythic(c) ? 1000 : 0) + rarityRank(c.rarity) * 100 + (c.firstFind ? 40 : 0) + (c.foil ? 20 : 0) + (c.shiny ? 10 : 0)
}

/**
 * The reveal's order, and how many cards get a beat before the summary: the highlights, at most BEST_MAX. They come
 * first and rise, so the beats build to the top pull; the rest follow best first (a stable order among equals). A new
 * species counts once, on its best copy, so two of one new common are news once.
 */
export function pullOrder<T extends Pull>(cards: readonly T[], fresh: ReadonlySet<string>): { cards: T[]; best: number } {
  const scored = cards.map((c, i) => ({ c, i, s: baseScore(c) }))
  const told = new Set<string>()
  for (const x of [...scored].sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (!fresh.has(x.c.species) || told.has(x.c.species)) continue
    told.add(x.c.species)
    x.s += NEW_SPECIES_BONUS
  }
  const sorted = scored.sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.c)
  const best = Math.min(BEST_MAX, scored.filter(x => x.s > 0).length)
  return { cards: [...sorted.slice(0, best).reverse(), ...sorted.slice(best)], best }
}

/** One chip of the summary: a card and how many identical pulls it stands for. */
export type Stack = { card: Card; count: number }
export type RarityGroup = { key: 'mythic' | Card['rarity']; label: string; count: number; stacks: Stack[] }

const GROUPS: readonly { key: RarityGroup['key']; label: string }[] = [
  { key: 'mythic', label: 'Mythic' }, { key: 'legendary', label: 'Legendary' }, { key: 'epic', label: 'Epic' },
  { key: 'rare', label: 'Rare' }, { key: 'common', label: 'Common' },
]

/** Same species, rarity, Alt colour and Foil; a Mythic, a fusion and a first find are each one of a kind. */
const stackKey = (c: Card) => (isMythic(c) || c.species === 'fusion' || c.firstFind ? `#${c.id}` : `${c.species}|${c.rarity}|${c.shiny ? 1 : 0}|${c.foil ? 1 : 0}`)

/**
 * The summary's groups, rarest first, empty ones left out; identical pulls stack into one chip, best first, so fifty
 * packs fit on a screen or two.
 */
export function rarityGroups(cards: readonly Card[], fresh: ReadonlySet<string> = new Set()): RarityGroup[] {
  const score = (c: Card) => baseScore(c) + (fresh.has(c.species) ? NEW_SPECIES_BONUS : 0)
  return GROUPS.map(g => {
    const mine = cards.filter(c => (isMythic(c) ? 'mythic' : c.rarity) === g.key)
    const by = new Map<string, Stack>()
    for (const c of mine) {
      const k = stackKey(c)
      const s = by.get(k)
      if (s) s.count++
      else by.set(k, { card: c, count: 1 })
    }
    const stacks = [...by.values()].map((s, i) => ({ s, i })).sort((a, b) => score(b.s.card) - score(a.s.card) || a.i - b.i).map(x => x.s)
    return { ...g, count: mine.length, stacks }
  }).filter(g => g.count > 0)
}

/** How many of the reveal's cards turn one by one: the best pulls of a bulk opening, every card otherwise. */
export function turns(r: Pick<Reveal, 'cards' | 'bulk'>): number {
  return r.bulk ? Math.min(r.cards.length, r.bulk.best ?? 0) : r.cards.length
}

/** Every pack is open and the cards are in their order: the ceremony can play. */
export const bulkReady = (r: Pick<Reveal, 'bulk'>) => !r.bulk || r.bulk.best !== undefined

/** `12 packs · 12 cards · 3 new species · Album 15/36 (+3)`, and what is still waiting when some could not open. */
export function bulkSummary(r: Reveal): string {
  const b = r.bulk
  if (!b) return ''
  const gained = r.album.after - r.album.before
  return dots(plural(b.opened, 'pack'), plural(r.cards.length, 'card'), r.fresh.length > 0 && plural(r.fresh.length, 'new species', 'new species'),
    `Album ${r.album.after}/${r.album.total}${gained > 0 ? ` (+${gained})` : ''}`, b.opened < b.packs && `${b.packs - b.opened} still waiting`)
}

/** A bulk opening's top pull: the last of its beats, or the first card when none earned one. */
export const topPull = (r: Pick<Reveal, 'cards' | 'bulk'>): Card | undefined => r.cards[Math.max(0, turns(r) - 1)]

// Trait names and one-line descriptions. Battle effects live in battle.ts and cards.ts (stat traits).
import type { TraitId } from './types.ts'

export const TRAIT_IDS: readonly TraitId[] = [
  'sturdy', 'swift', 'thickHide', 'luckyStar', 'quickCharge', 'glassHeart', 'regrowth', 'underdog',
  'ambush', 'moonlit', 'stubborn', 'showoff', 'guardian', 'sleepy', 'homebody', 'mimic',
]

export const TRAITS: Record<TraitId, { name: string; text: string }> = {
  sturdy: { name: 'Sturdy', text: 'Shrugs off its first knockout blow with 1 HP left, once per battle' },
  swift: { name: 'Swift', text: '+15% speed' },
  thickHide: { name: 'Thick Hide', text: 'Takes 10% less damage' },
  luckyStar: { name: 'Lucky Star', text: 'Lands critical hits twice as often' },
  quickCharge: { name: 'Quick Charge', text: 'Its special is ready after one attack instead of two' },
  glassHeart: { name: 'Glass Heart', text: '+20% attack, but 15% less HP' },
  regrowth: { name: 'Regrowth', text: 'Heals 6% of its HP at the end of each round in play' },
  underdog: { name: 'Underdog', text: '+25% attack while below 30% HP' },
  ambush: { name: 'Ambush', text: '+30% damage on its first move after stepping in' },
  moonlit: { name: 'Moonlit', text: 'Its special heals it for a quarter of the damage dealt' },
  stubborn: { name: 'Stubborn', text: 'Never weakened by a bad matchup' },
  showoff: { name: 'Showoff', text: 'Its special hits 25% harder' },
  guardian: { name: 'Guardian', text: 'When it faints, the next friend gets +15% defense' },
  sleepy: { name: 'Sleepy', text: '10% slower, but 15% more HP' },
  homebody: { name: 'Homebody', text: 'Its home arena bonus is +20% instead of +10%' },
  mimic: { name: 'Mimic', text: "Its special copies the move of the opponent's family" },
}

export function isTrait(v: unknown): v is TraitId {
  return typeof v === 'string' && Object.hasOwn(TRAITS, v)
}

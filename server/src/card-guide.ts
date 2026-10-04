// Browser card explanations use the same rule tables as battles. These are public card facts.
import { geneMult } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { beatenBy, FAMILY_INFO, SPECIALS } from '../../plugin/hooks/core/families.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, Family, Stats } from '../../plugin/hooks/core/types.ts'

const percent = (value: number) => Math.round(value * 100)

function familyMove(family: Family): { name: string; text: string } {
  const move = SPECIALS[FAMILY_INFO[family].special]
  const effect = move.hits > 1 ? `${move.hits} hits at ${move.mult}× normal-hit power each.` : `One hit at ${move.mult}× normal-hit power.`
  const extra = move.heal ? ` Then heals ${percent(move.heal)}% of its maximum HP.` : move.alwaysSuper ? ' Always counts as super effective.' : ''
  return { name: move.name, text: effect + extra }
}

export const CARD_HELP = {
  stats: {
    hp: { label: 'HP', short: 'HP', text: 'Health points. At 0 HP this creature faints and the next teammate steps in.' },
    atk: { label: 'Attack', short: 'Atk', text: 'Strength of its hits. Damage also depends on the target’s Defense, family matchup, arena, move, traits and critical hits.' },
    def: { label: 'Defense', short: 'Def', text: 'Reduces incoming damage. Higher Defense softens hits; it does not subtract this number directly from Attack.' },
    spd: { label: 'Speed', short: 'Spd', text: 'The faster active creature acts first each round. Ties alternate between the attacking and defending team.' },
  },
  genes: `Its four genes each range from 0 to 15 and change one stat by up to ${percent(1 - ECONOMY.stats.geneBase)}%. The score averages their points into a percentage, not a damage bonus. Their effects are already included in the stats shown.`,
  traits: TRAITS,
  families: Object.fromEntries(Object.entries(FAMILY_INFO).map(([key, family]) => [key, {
    name: family.name,
    text: `${family.name} normally hits ${FAMILY_INFO[family.beats].name} for ${ECONOMY.battle.typeStrong}× damage and ${FAMILY_INFO[beatenBy(key as Family)].name} for ${ECONOMY.battle.typeWeak}×. Topsy-Turvy reverses these matchups. In its own family’s arena, it deals ${percent(ECONOMY.battle.arena - 1)}% more damage (${percent(ECONOMY.battle.homebodyArena - 1)}% with Homebody).`,
    special: familyMove(key as Family),
  }])) as Record<Family, { name: string; text: string; special: { name: string; text: string } }>,
  charge: { normal: ECONOMY.battle.chargeNeed, quick: 1, perfect: percent(ECONOMY.battle.perfect - 1) },
  damage: `A normal hit starts from Attack × Attack ÷ (Attack + the target’s Defense). It then changes with family matchup, arena, move, traits, the day’s rule, ${percent(ECONOMY.battle.variance[0])}–${percent(ECONOMY.battle.variance[1])}% variation and critical hits. A critical hit normally deals ${ECONOMY.battle.crit}× damage. There is no single fixed damage value for a card.`,
  finishes: 'Shiny changes the creature’s colours and sparkle. Foil changes its card frame. Both are cosmetic and do not change combat stats.',
}

export const STAT_KEYS: readonly (keyof Stats)[] = ['hp', 'atk', 'def', 'spd']

export function geneChange(gene: number): string {
  const change = Math.round((geneMult(gene) - 1) * 1000) / 10
  return `${change > 0 ? '+' : ''}${change}%`
}

export function cardMove(c: Pick<BattleCard, 'family' | 'traits'>): { name: string; text: string } {
  const move = CARD_HELP.families[c.family].special
  const charge = c.traits.includes('quickCharge') ? 1 : ECONOMY.battle.chargeNeed
  const timing = `Fires automatically after ${charge} normal attack${charge === 1 ? '' : 's'}. A Perfect press in Claude adds ${percent(ECONOMY.battle.perfect - 1)}% power.`
  if (c.traits.includes('mimic')) return { name: 'Mimic special', text: `Copies the special of the opposing active creature’s family. ${timing}` }
  return { name: move.name, text: `${move.text} ${timing}` }
}

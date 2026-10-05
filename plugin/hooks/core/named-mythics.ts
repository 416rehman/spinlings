// These wild Mythics get one worldwide appearance. The server reserves an id when the encounter starts.
import type { BattleCard } from './types.ts'

export const NAMED_MYTHICS = [
  { id: 'dario', name: 'Dario' },
  { id: 'marshmallow-menace', name: 'Marshmallow Menace' },
  { id: 'noodle-knight', name: 'Noodle Knight' },
  { id: 'soggy-emperor', name: 'Soggy Emperor' },
] as const

/** Reuse the ordinary Mythic roll unchanged, except for its embedded name at every stage. */
export function namedMythic(card: BattleCard, entry: (typeof NAMED_MYTHICS)[number]): BattleCard {
  if (card.species !== 'mythic' || card.form?.kind !== 'mythic') throw new TypeError('A named Mythic needs a Mythic form')
  return { ...card, form: { ...card.form, names: [entry.name, entry.name, entry.name] } }
}

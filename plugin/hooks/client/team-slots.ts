// The team is an ordered list without gaps. Replacing changes only membership; swapping keeps both teammates.
import type { Card } from '../core/types.ts'
import { ECONOMY } from '../core/economy.ts'

export type TeamSlotChoice = {
  slot: number
  card: Card | null
  kind: 'replace' | 'swap' | 'add' | 'here' | 'empty' | 'waiting'
  ids: string[] | null
}

export function teamSlotChoices(team: readonly string[], cardId: string, cards: readonly Card[]): TeamSlotChoice[] {
  const owned = (id: string) => cards.find(c => c.id === id && c.state === 'owned') ?? null
  const ready = !!owned(cardId) && team.length <= ECONOMY.teamSize && new Set(team).size === team.length && team.every(id => owned(id))
  const at = team.indexOf(cardId)
  return Array.from({ length: ECONOMY.teamSize }, (_, slot) => {
    const card = team[slot] ? owned(team[slot]!) : null
    if (!ready) return { slot, card, kind: 'waiting', ids: null }
    if (slot === at) return { slot, card, kind: 'here', ids: null }
    if (slot < team.length) {
      const ids = team.map((id, i) => i === slot ? cardId : at >= 0 && i === at ? team[slot]! : id)
      return { slot, card, kind: at >= 0 ? 'swap' : 'replace', ids }
    }
    if (slot === team.length && at < 0) return { slot, card, kind: 'add', ids: [...team, cardId] }
    return { slot, card, kind: 'empty', ids: null }
  })
}

// /v1's four special labels are permanent. New rules can change their effects, but a new move id
// must not make an installed reader reject the entire authoritative log. HP, damage and outcome
// stay untouched; an omitted label already renders as a generic special in every released mod.
import type { FinishBattleResponse } from '../../../../plugin/hooks/core/api.ts'

const SPECIALS_V1 = new Set(['flurry', 'couplet', 'crescendo', 'twist'])

export function finishView(answer: FinishBattleResponse): FinishBattleResponse {
  return {
    ...answer,
    log: {
      ...answer.log,
      rounds: answer.log.rounds.map(round => ({
        ...round,
        actions: round.actions.map(action => {
          if (action.special === undefined || SPECIALS_V1.has(action.special)) return action
          const { special: _, ...generic } = action
          return generic
        }),
      })),
    },
  }
}

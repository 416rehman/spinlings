// Stored battle rules select an append-only engine, independently of the currently advertised rules.
import type { BattleLog, BattleSetup } from '../../../../plugin/hooks/core/types.ts'
import { simulateBattleV1 } from './v1.ts'

export function replayRules(rules: number, setup: BattleSetup, inputs: readonly number[]): BattleLog | null {
  try {
    if (setup.rules !== rules) return null
    if (rules === 1) return simulateBattleV1(setup, inputs)
    return null
  } catch {
    return null
  }
}

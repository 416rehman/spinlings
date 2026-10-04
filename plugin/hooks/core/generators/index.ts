// Append-only species generators. An offline world's saved version selects its original forms.
import type { Species } from '../types.ts'
import { generateSeasonV2 } from './v2.ts'

export const GENERATOR_VERSIONS: readonly number[] = Object.freeze([2])

export function generateSeason(season: number, version: number): Species[] {
  if (version === 2) return generateSeasonV2(season)
  throw new RangeError('Unsupported species generator')
}

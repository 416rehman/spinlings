// Browser demos use the page's frozen catalog. A missing form never starts an offline generator.
import type { Species } from '../../../plugin/hooks/core/types.ts'

export function generateSeason(_season: number, _version: number): Species[] {
  throw new Error('The page is missing its frozen species')
}

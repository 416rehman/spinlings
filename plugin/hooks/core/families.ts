// The four families (one per Claude model), the type cycle and the specials. SPEC.md section 3.
import type { DailyRule, Family, SpecialId, Stats } from './types.ts'
import { ECONOMY } from './economy.ts'
import { hashString } from './rng.ts'

export const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']

export type FamilyInfo = {
  name: string
  /** inclusive hue range in degrees; `from > to` wraps through 0 */
  hue: [number, number]
  /** stat bias weights, summing to the 100-point budget */
  bias: Stats
  special: SpecialId
  /** the family this one beats */
  beats: Family
}

export const FAMILY_INFO: Record<Family, FamilyInfo> = {
  haiku: { name: 'Haiku', hue: [85, 165], bias: { hp: 24, atk: 26, def: 18, spd: 32 }, special: 'flurry', beats: 'fable' },
  sonnet: { name: 'Sonnet', hue: [190, 255], bias: { hp: 28, atk: 26, def: 24, spd: 22 }, special: 'couplet', beats: 'haiku' },
  opus: { name: 'Opus', hue: [345, 40], bias: { hp: 34, atk: 30, def: 24, spd: 12 }, special: 'crescendo', beats: 'sonnet' },
  fable: { name: 'Fable', hue: [260, 320], bias: { hp: 26, atk: 28, def: 22, spd: 24 }, special: 'twist', beats: 'opus' },
}

export type SpecialInfo = { name: string; text: string; mult: number; hits: number; heal: number; alwaysSuper: boolean }

export const SPECIALS: Record<SpecialId, SpecialInfo> = {
  flurry: { name: 'Flurry', text: 'Two quick hits', mult: ECONOMY.specials.flurry, hits: 2, heal: 0, alwaysSuper: false },
  couplet: { name: 'Couplet', text: 'A strong hit, then a little rest', mult: ECONOMY.specials.couplet, hits: 1, heal: ECONOMY.specials.coupletHeal, alwaysSuper: false },
  crescendo: { name: 'Crescendo', text: 'One mighty blow', mult: ECONOMY.specials.crescendo, hits: 1, heal: 0, alwaysSuper: false },
  twist: { name: 'Twist', text: 'A sly hit that always lands where it hurts', mult: ECONOMY.specials.twist, hits: 1, heal: 0, alwaysSuper: true },
}

export function isFamily(v: unknown): v is Family {
  return v === 'haiku' || v === 'sonnet' || v === 'opus' || v === 'fable'
}

/** The family of a model id; unknown models hash onto one. */
export function familyOfModel(modelId: string): Family {
  const id = modelId.toLowerCase()
  for (const f of FAMILIES) if (id.includes(f)) return f
  return FAMILIES[hashString(modelId) % FAMILIES.length]!
}

export function beats(family: Family): Family {
  return FAMILY_INFO[family].beats
}

export function beatenBy(family: Family): Family {
  return FAMILIES.find(f => FAMILY_INFO[f].beats === family)!
}

/** Type multiplier for an attacker of family `att` hitting `def`. Topsy-Turvy reverses the cycle. */
export function typeMult(att: Family, def: Family, rule: DailyRule = 'calm'): number {
  const strong = rule === 'topsyTurvy' ? beats(def) === att : beats(att) === def
  const weak = rule === 'topsyTurvy' ? beats(att) === def : beats(def) === att
  return strong ? ECONOMY.battle.typeStrong : weak ? ECONOMY.battle.typeWeak : 1
}

/** Width of a family's hue range in degrees. */
export function hueSpan(family: Family): number {
  const [from, to] = FAMILY_INFO[family].hue
  return (to - from + 360) % 360
}

export function inHueRange(family: Family, hue: number): boolean {
  const from = FAMILY_INFO[family].hue[0]
  return (((hue - from) % 360) + 360) % 360 <= hueSpan(family)
}

/** Clamps a hue into the family's range (to the nearer end when outside). Result is in [0, 360). */
export function clampHue(family: Family, hue: number): number {
  const from = FAMILY_INFO[family].hue[0]
  const span = hueSpan(family)
  const off = (((hue - from) % 360) + 360) % 360
  const clamped = off <= span ? off : off - span < 360 - off ? span : 0
  return (from + clamped) % 360
}

/** The hue at fraction t (0..1) through the family's range. */
export function hueAt(family: Family, t: number): number {
  return (FAMILY_INFO[family].hue[0] + t * hueSpan(family)) % 360
}

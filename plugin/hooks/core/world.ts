// The living world: seasons, the daily rule, the featured species and the weekly roamer.
// All of it is a pure function of the date, so the mod and the server always agree.
import type { DailyRule } from './types.ts'
import { ECONOMY } from './economy.ts'
import { hashString } from './rng.ts'
import { seasonSpecies } from './species.ts'

export const DAY_MS = 86_400_000
export const EPOCH_MS = Date.UTC(2026, 9, 1)
export const SEASON_MS = 28 * DAY_MS

export const DAILY_RULES: readonly DailyRule[] = [
  'haikuDay', 'sonnetDay', 'opusDay', 'fableDay', 'topsyTurvy', 'glassDay',
  'longDay', 'gentleDay', 'wildBloom', 'shinyHour', 'fusionFair', 'calm',
]

export const RULE_INFO: Record<DailyRule, { name: string; text: string }> = {
  haikuDay: { name: 'Haiku Day', text: 'Haiku creatures get +20% speed' },
  sonnetDay: { name: 'Sonnet Day', text: 'Sonnet creatures heal 4% each round' },
  opusDay: { name: 'Opus Day', text: 'Opus creatures get +15% attack' },
  fableDay: { name: 'Fable Day', text: 'Fable specials are ready after 1 charge' },
  topsyTurvy: { name: 'Topsy-Turvy', text: 'The type cycle runs backwards' },
  glassDay: { name: 'Glass Day', text: 'Critical hits deal double' },
  longDay: { name: 'Long Day', text: 'Battles last up to 30 rounds' },
  gentleDay: { name: 'Gentle Day', text: 'All damage is 15% softer' },
  wildBloom: { name: 'Wild Bloom', text: 'Catch chance is 80%' },
  shinyHour: { name: 'Shiny Hour', text: 'From 18:00 to 19:00 UTC, shinies are 1 in 25' },
  fusionFair: { name: 'Fusion Fair', text: 'Fusion costs 20 sparks' },
  calm: { name: 'Calm Day', text: 'A quiet day in the meadow' },
}

export function seasonOf(now: number): number {
  return Math.max(1, Math.floor((now - EPOCH_MS) / SEASON_MS) + 1)
}

export function seasonStart(season: number): number {
  return EPOCH_MS + (season - 1) * SEASON_MS
}

/** 'YYYY-MM-DD' in UTC. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** ISO-8601 week, e.g. '2026-W40'. */
export function isoWeek(now: number): string {
  const day = Math.floor(now / DAY_MS)
  const dow = (new Date(day * DAY_MS).getUTCDay() + 6) % 7
  const thursday = day - dow + 3
  const year = new Date(thursday * DAY_MS).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1) / DAY_MS) / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function dailyRule(now: number): DailyRule {
  return DAILY_RULES[hashString('spinlings/day/' + utcDay(now)) % DAILY_RULES.length]!
}

/** Today's featured species id: one of the current season's regular species. */
export function featuredSpecies(now: number): string {
  const regular = seasonSpecies(seasonOf(now)).filter(s => !s.legendary)
  return regular[hashString('spinlings/featured/' + utcDay(now)) % regular.length]!.id
}

/** This ISO week's roaming legendary species id, from the current season. */
export function weeklyRoamer(now: number): string {
  const legends = seasonSpecies(seasonOf(now)).filter(s => s.legendary)
  return legends[hashString('spinlings/roamer/' + isoWeek(now)) % legends.length]!.id
}

export function isShinyHour(now: number, rule: DailyRule = dailyRule(now)): boolean {
  return rule === 'shinyHour' && new Date(now).getUTCHours() === ECONOMY.shiny.hourStartUtc
}

export function shinyChance(now: number, rule: DailyRule = dailyRule(now)): number {
  return isShinyHour(now, rule) ? ECONOMY.shiny.hourChance : ECONOMY.shiny.chance
}

export function roundLimit(rule: DailyRule): number {
  return rule === 'longDay' ? ECONOMY.battle.longDayRoundLimit : ECONOMY.battle.roundLimit
}

export function fusionCost(rule: DailyRule): number {
  return rule === 'fusionFair' ? ECONOMY.fusion.fairCost : ECONOMY.fusion.cost
}

export function catchChance(rule: DailyRule): number {
  return rule === 'wildBloom' ? ECONOMY.battle.wildBloomCatchChance : ECONOMY.battle.catchChance
}

export type WorldState = { day: string; season: number; rule: DailyRule; featured: string; roamer: string }

export function worldOf(now: number): WorldState {
  return { day: utcDay(now), season: seasonOf(now), rule: dailyRule(now), featured: featuredSpecies(now), roamer: weeklyRoamer(now) }
}

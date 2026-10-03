// The world the site's pages are drawn from, read once per request: the frozen season, the species
// somebody has found (with the day of each first find), today's rule and featured species, the 8
// regulars named through core/naming.ts, and the JSON the landing embeds in <main data-world>. It
// carries no handle and nothing about a Mythic (site brief 2.7); the lanterns are server-rendered.
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import { speciesNameLine } from '../../plugin/hooks/core/naming.ts'
import type { CardForm, Family, Species } from '../../plugin/hooks/core/types.ts'
import { fusionCost, seasonOf, seasonStart, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import type { Db } from './db.ts'
import { DAY, ensureSeason } from './game/ctx.ts'
import { regularForm, regularSeed } from './pages-meet.ts'
import type { SiteWorld } from './pages-meet.ts'

const REGULARS = new Map<string, CardForm[]>()

/**
 * The 8 regulars, haiku 0 and 1 first; their names come from the game's name generator. Given a
 * season's species, no regular shares a name with any of them, so a regular is never mistaken for
 * a species nobody has found yet.
 */
export function regulars(season: readonly Species[] = []): CardForm[] {
  const key = season.map(s => s.names.join('/')).join('|')
  let out = REGULARS.get(key)
  if (!out) {
    const taken: string[] = season.flatMap(s => [...s.names])
    out = FAMILIES.flatMap((f: Family) => [0, 1].map(i => {
      const names = speciesNameLine(regularSeed(f, i), f, false, taken)
      taken.push(...names)
      return regularForm(f, i, names)
    }))
    REGULARS.set(key, out)
  }
  return out
}

export type SiteFacts = SiteWorld & { seasonDay: number; daysLeft: number }

/** The world of `season` as of `now` (or the season's last moment, for a past season). */
export async function siteWorld(db: Db, now: number, season = seasonOf(now)): Promise<SiteFacts> {
  const { species } = await ensureSeason(db, season)
  const at = Math.min(now, seasonStart(season + 1) - 1)
  const w = worldOf(at)
  const found = await db.all<{ species: string; day: string }>('SELECT species, day FROM firsts WHERE season = ? ORDER BY day, species', season)
  return {
    now: at, day: w.day, season, rule: w.rule, featured: w.featured,
    found: found.map(r => [r.species, r.day] as [string, string]),
    species: [...species], regulars: regulars(species),
    seasonDay: Math.floor((at - seasonStart(season)) / DAY) + 1,
    daysLeft: Math.ceil((seasonStart(season + 1) - at) / DAY),
  }
}

export type Preview = Partial<{
  rule: string; shiny: string; rarity: string; foil: string; found: string; scheme: string; motion: string; perf: string; mythics: string
}>

/** The JSON for <main data-world>: the world and nothing about any player. */
export function worldJson(w: SiteFacts, preview: Preview | null): string {
  const shinyHour = w.rule === 'shinyHour'
    ? [Date.parse(w.day + 'T00:00:00Z') + ECONOMY.shiny.hourStartUtc * 3_600_000, Date.parse(w.day + 'T00:00:00Z') + (ECONOMY.shiny.hourStartUtc + 1) * 3_600_000]
    : null
  return JSON.stringify({
    v: 1, now: w.now, day: w.day, season: w.season, seasonDay: w.seasonDay, daysLeft: w.daysLeft, rule: w.rule, featured: w.featured,
    found: w.found, species: w.species, regulars: w.regulars, fusionCost: fusionCost(w.rule), shinyHour,
    ...(preview ? { preview } : {}),
  })
}

/** Today's day key for og images: yyyymmdd. */
export const dayKey = (now: number) => utcDay(now).replace(/-/g, '')

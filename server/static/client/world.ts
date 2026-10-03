// The page's world (from <main data-world>) and the visitor's team: their creature, met from a seed
// by the same pages-meet.ts the server uses, and two regulars for the hour. Changes are broadcast so
// the header, hero, battle, den and campfire all show the same creature at the same stage.
import { applyXp, cardStats, stageFor } from '../../../plugin/hooks/core/cards.ts'
import { installSeason } from '../../../plugin/hooks/core/species.ts'
import type { Family } from '../../../plugin/hooks/core/types.ts'
import { HOUR_FAMILY, meet, newSeed, teamRegulars } from '../../src/pages-meet.ts'
import type { Hour, SiteCard, SiteWorld } from '../../src/pages-meet.ts'
import { $, H, store } from './util.ts'

export type World = SiteWorld & {
  seasonDay: number
  daysLeft: number
  fusionCost: number
  shinyHour: [number, number] | null
  preview?: Record<string, string>
}

const main = $('main')
export const W: World | null = (() => {
  try {
    const raw = main?.getAttribute('data-world')
    if (!raw) return null
    const w = JSON.parse(raw) as World
    return installSeason(w.season, w.species) ? w : null
  } catch { return null }
})()

export const hour = (): Hour => (H.dataset.hour as Hour) || 'dusk'
export const hourFamily = (): Family => HOUR_FAMILY[hour()]

type Listener = () => void
const listeners: Listener[] = []
export const onTeam = (fn: Listener) => { listeners.push(fn) }
export const changed = () => listeners.forEach(f => f())

/** The lead, its seed and the entry it met (kept beside the seed, so it meets the same one on a later day). */
export const T: { lead: SiteCard | null; seed: string | null; entry: string | null; met: boolean } = { lead: null, seed: null, entry: null, met: false }

/** The two regulars for the current hour, levels 4 and 5. */
export const regulars = (): [SiteCard, SiteCard] => teamRegulars(W!, hour())

/** The team that battles: the lead (once met) and the hour's two regulars. */
export const team = (): SiteCard[] => (T.met && T.lead ? [T.lead, ...regulars()] : regulars())

const THIRTY_DAYS = 30 * 86_400_000

/**
 * A saved creature less than 30 days old, still of this season, at its saved level. The page knows
 * no first find's day, so a seed of an earlier day meets its kept entry; a save from before entries
 * were kept is met from today's world once and keeps what it met from then on.
 */
export function restore(): boolean {
  const s = store.get()
  if (!W || !s?.seed || typeof s.t !== 'number' || Date.now() - s.t > THIRTY_DAYS) return false
  const m = meet(s.seed, W, typeof s.entry === 'string' ? s.entry : undefined)
  if (!m) return false
  const level = Math.max(3, Math.min(10, Math.floor(Number(s.level) || 3)))
  const xp = Math.max(0, Math.floor(Number(s.xp) || 0))
  const lead = { ...m.card, level, xp, stage: stageFor(level) }
  lead.stats = cardStats(lead)
  T.lead = lead
  T.seed = s.seed
  T.entry = m.entry
  T.met = true
  if (s.entry !== m.entry) store.set({ entry: m.entry })
  return true
}

/** Rolls a new wild one for this visitor (not yet met). */
export function roll(): SiteCard {
  const seed = newSeed(W!.day, hour(), crypto.getRandomValues(new Uint8Array(8)))
  const m = meet(seed, W!)!
  const card = { ...m.card }
  const p = W!.preview
  if (p?.rarity && ['common', 'rare', 'epic'].includes(p.rarity)) card.rarity = p.rarity as SiteCard['rarity']
  if (p?.shiny === '1') card.shiny = true
  if (p?.foil === '1') card.foil = true
  T.lead = card
  T.seed = seed
  T.entry = m.entry
  T.met = false
  return card
}

/** Keeps the met creature. */
export function keep() {
  if (!T.lead || !T.seed || !T.entry) return
  T.met = true
  store.set({ seed: T.seed, entry: T.entry, level: T.lead.level, xp: T.lead.xp })
  changed()
}

/** The lead's postcard link. It carries the kept entry, which the server cannot work out from the seed (pages-meet meet). */
export const postcardUrl = () => `${location.origin}/w/${T.seed}?e=${encodeURIComponent(T.entry ?? '')}`

/** What xp would make of the lead, without keeping it yet (the battle shows the evolution first). */
export const growth = (xp: number) => applyXp(T.lead!, xp)

/** Keeps the lead as it now is, and tells everyone. */
export function commit(card: SiteCard) {
  T.lead = card
  store.set({ seed: T.seed!, level: card.level, xp: card.xp })
  changed()
}

/** Late-bound actions other modules can trigger: the popover's "Meet a new one", and a band catch landing in the den's nest. */
export const hooks = { meetNew: () => {}, caught: (_c: SiteCard) => {} }

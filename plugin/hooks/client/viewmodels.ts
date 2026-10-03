// What the pane shows, as plain data (SPEC 9, 13, 14, 21, 25, 28, 30): team slots, the collection page, the card's
// possible actions and their consequences, the album, the Trade tab's sections, the Trader's picks, the reveal's
// summary and the daily hello. Pure: no $, no elements; the views in ui/pane*.tsx and ui/ceremony*.tsx draw these.
import type { OfferView } from '../core/api.ts'
import type { Card, Family, Rarity, Species, TraderDeal } from '../core/types.ts'
import { ECONOMY } from '../core/economy.ts'
import { FAMILIES, FAMILY_INFO } from '../core/families.ts'
import { cardPower, craftCost, rarityFits, rarityRank, recycleValue } from '../core/cards.ts'
import { getSpecies, seasonSpecies } from '../core/species.ts'
import { RULE_INFO, dailyRule, featuredSpecies, fusionCost, seasonOf, utcDay } from '../core/world.ts'
import { nameOf } from './game.ts'
import type { GameState, HoldAction, PaneUi, Reveal, Tab, View } from './types.ts'
import { dots, plural, safe, span, title } from './text.ts'

const DAY = 86_400_000

// ---------- where the pane is ----------

/** The screen on show: the top pushed view, or the tab itself. */
export type Screen = { kind: 'tab'; tab: Tab } | View

export function screenOf(p: PaneUi): Screen {
  return p.stack[p.stack.length - 1] ?? { kind: 'tab', tab: p.tab }
}

/** Replaces the top view of the stack (a picker's choice, the offer being built, the demo's step). */
export function withTop(p: PaneUi, fn: (v: View) => View): PaneUi {
  if (p.stack.length === 0) return p
  return { ...p, stack: [...p.stack.slice(0, -1), fn(p.stack[p.stack.length - 1]!)] }
}

// ---------- the Trade tab's sections ----------

export type TradeSection = 'inbox' | 'board' | 'trader' | 'gifts'
export const TRADE_SECTIONS: readonly TradeSection[] = ['inbox', 'board', 'trader', 'gifts']

/** The Trade tab keeps its section in pane.page (switching tabs resets it to the inbox). */
export function tradeSection(page: number, offline: boolean): TradeSection {
  if (offline) return 'trader'
  return TRADE_SECTIONS[page] ?? 'inbox'
}

// ---------- the collection ----------

export const FILTER_FAMILIES: readonly (Family | 'all')[] = ['all', ...FAMILIES]
export const FILTER_RARITIES: readonly (Rarity | 'all')[] = ['all', 'common', 'rare', 'epic', 'legendary']

export function cycle<T>(list: readonly T[], at: T, by = 1): T {
  const i = list.indexOf(at)
  return list[(((i < 0 ? 0 : i) + by) % list.length + list.length) % list.length]!
}

/** Newest first, so what a pack or a catch just brought is on the first page; rarer first among equals. */
export function byNewest(a: Card, b: Card): number {
  return b.mintedAt - a.mintedAt || rarityRank(b.rarity) - rarityRank(a.rarity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function collection(cards: readonly Card[], family: Family | 'all', rarity: Rarity | 'all'): Card[] {
  return cards.filter(c => (family === 'all' || c.family === family) && (rarity === 'all' || c.rarity === rarity)).sort(byNewest)
}

/** How many items of `width` cells fit across `columns` with `gap` between them. */
export function perRow(columns: number, width: number, gap = 1): number {
  return Math.max(1, Math.floor((columns + gap) / (width + gap)))
}

export function paged<T>(items: readonly T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / Math.max(1, size)))
  const p = Math.min(Math.max(0, page), pages - 1)
  return { items: items.slice(p * size, p * size + size), page: p, pages }
}

export function filterLabel(family: Family | 'all', rarity: Rarity | 'all'): string {
  return dots(family === 'all' ? 'All families' : FAMILY_INFO[family].name, rarity === 'all' ? 'all rarities' : title(rarity))
}

// ---------- the team ----------

export type Slot = { slot: number; card: Card | null; restingMs: number }

export function teamSlots(team: readonly string[], cards: readonly Card[], now: number): Slot[] {
  return [0, 1, 2].map(slot => {
    const card = cards.find(c => c.id === team[slot]) ?? null
    return { slot, card, restingMs: card ? Math.max(0, card.tiredUntil - now) : 0 }
  })
}

/** Where "Set in team" puts a card: an empty slot, else in place of the weakest; a team card can lead instead. */
export type TeamPlace =
  | { kind: 'add'; ids: string[] }
  | { kind: 'replace'; ids: string[]; replaced: Card }
  | { kind: 'lead'; ids: string[] }
  | { kind: 'leads' }

export function teamPlace(team: readonly string[], card: Card, cards: readonly Card[]): TeamPlace {
  const members = team.filter(id => cards.some(c => c.id === id))
  const at = members.indexOf(card.id)
  if (at === 0) return { kind: 'leads' }
  if (at > 0) return { kind: 'lead', ids: [card.id, ...members.filter(id => id !== card.id)] }
  if (members.length < ECONOMY.teamSize) return { kind: 'add', ids: [...members, card.id] }
  let weakest = 0
  members.forEach((id, i) => {
    const c = cards.find(x => x.id === id)!, w = cards.find(x => x.id === members[weakest])!
    if (cardPower(c) < cardPower(w)) weakest = i
  })
  const replaced = cards.find(c => c.id === members[weakest])!
  return { kind: 'replace', ids: members.map((id, i) => (i === weakest ? card.id : id)), replaced }
}

/** The strongest three free cards: the pack summary's one-press "Set team". */
export function bestTeam(cards: readonly Card[]): string[] {
  return cards.filter(c => c.state === 'owned').sort((a, b) => cardPower(b) - cardPower(a) || byNewest(a, b)).slice(0, ECONOMY.teamSize).map(c => c.id)
}

// ---------- one card's actions ----------

export type CardCan = {
  /** set for trade / keep (online, past the trust gate, free to trade) */
  trade: boolean
  gift: boolean
  recycle: boolean
  fuse: boolean
  /** why trading or gifting is not offered, in plain words; '' when it is (or the world has no trading) */
  tradeNote: string
}

export function tradeable(c: Card, now: number): boolean {
  return c.state === 'owned' && !c.bound && c.lockedUntil <= now
}

export function cardCan(c: Card, o: { offline: boolean; canTrade: boolean; now: number }): CardCan {
  if (c.state === 'escrow') return { trade: false, gift: false, recycle: false, fuse: false, tradeNote: 'Held for a trade until it settles' }
  const free = !c.bound
  const social = !o.offline && free && o.canTrade && c.lockedUntil <= o.now
  const tradeNote = o.offline || !free ? ''
    : !o.canTrade ? 'Trading opens once your account is 3 days old with 10 battles'
    : c.lockedUntil > o.now ? `Can trade in ${span(c.lockedUntil - o.now)}` : ''
  return {
    trade: social,
    gift: social,
    recycle: free,
    fuse: free,
    tradeNote,
  }
}

/** The one-line consequence a 2-second hold shows (SPEC 21.8). */
export function holdText(action: HoldAction, target: string, s: Pick<GameState, 'cards' | 'me' | 'account'>, now: number): string {
  const card = (id: string | undefined) => s.cards.find(c => c.id === id)
  const name = (id: string | undefined) => { const c = card(id); return c ? nameOf(c) : 'That card' }
  switch (action) {
    case 'recycle': {
      const c = card(target)
      return `${name(target)} will be gone. You get ${c ? recycleValue(c) : 0} sparks.`
    }
    case 'fuse': {
      const [a, b] = target.split('|')
      return `${name(a)} and ${name(b)} will be gone, and their hybrid hatches. ${fusionCost(dailyRule(now))} sparks.`
    }
    case 'gift': return `${name(target)} is wrapped and held until someone claims it (14 days).`
    case 'cancel-offer': {
      const o = s.me?.offers.outgoing.find(x => x.id === target)
      return `The offer${o ? ` to ${safe(o.to, 40)}` : ''} is withdrawn. Your cards come back.`
    }
    case 'cancel-gift': {
      const g = s.me?.gifts.find(x => x.code === target)
      return `The code stops working${g ? ` and ${nameOf(g.card)} comes back` : ''}.`
    }
    case 'delete-account': return s.account.world === 'online'
      ? `Your account, cards and handle on ${s.account.host} are gone for good.`
      : 'Your offline collection on this machine is gone for good.'
    case 'reset-access': return 'Other machines will need to sign in again.'
    case 'delete-offline': return 'The offline save on this machine is gone for good.'
  }
}

/** The verb a hold's second press does. */
export const HOLD_VERB: Record<HoldAction, string> = {
  recycle: 'recycle', fuse: 'fuse', gift: 'wrap the gift', 'cancel-offer': 'cancel the offer', 'cancel-gift': 'cancel the gift',
  'delete-account': 'delete', 'reset-access': 'reset access', 'delete-offline': 'delete the save',
}

/** Cards that can be fused with `card`: yours, not bound, not held for a trade. */
export function fusePartners(card: Card, cards: readonly Card[]): Card[] {
  return cards.filter(c => c.id !== card.id && c.state === 'owned' && !c.bound).sort(byNewest)
}

// ---------- the album ----------

export type AlbumEntry = { species: Species; seen: boolean; owned: number; wished: boolean }

export function albumEntries(season: number, family: Family, seen: readonly string[], cards: readonly Card[], wishlist: readonly string[]): AlbumEntry[] {
  const seenSet = new Set(seen)
  return seasonSpecies(season).filter(s => s.family === family).map(species => ({
    species,
    seen: seenSet.has(species.id) || cards.some(c => c.species === species.id),
    owned: cards.filter(c => c.species === species.id).length,
    wished: wishlist.includes(species.id),
  }))
}

export function albumCount(season: number, seen: readonly string[], cards: readonly Card[]): { seen: number; total: number } {
  const all = seasonSpecies(season)
  const set = new Set([...seen, ...cards.map(c => c.species)])
  return { seen: all.filter(s => set.has(s.id)).length, total: all.length }
}

/** The Fusion Log: hybrids you have made and still hold, newest first. */
export function fusionLog(cards: readonly Card[]): Card[] {
  return cards.filter(c => c.species === 'fusion').sort(byNewest)
}

/** The parents' names of a fusion, from its form ('?' for a parent this mod cannot name). */
export function parentsLine(c: Card): string {
  const names = (c.form?.parents ?? []).map(id => { const s = getSpecies(id); return s ? s.names[0] : '?' })
  return names.length === 2 ? `${names[0]} × ${names[1]}` : ''
}

export type CraftChoice = { rarity: Rarity; cost: number; ok: boolean }

/** What a species can be crafted as: the current season only; a legendary species only as legendary. */
export function craftChoices(species: Species, sparks: number, now: number): CraftChoice[] {
  if (species.season !== seasonOf(now)) return []
  const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary']
  return rarities.filter(r => rarityFits(species, r)).map(rarity => ({ rarity, cost: craftCost(rarity), ok: sparks >= craftCost(rarity) }))
}

// ---------- trading ----------

/** `Fogmaw R5`: a card as an offer line names it. */
export function cardWord(c: Pick<Card, 'species' | 'form' | 'stage' | 'rarity' | 'level'>): string {
  return `${nameOf(c)} ${c.rarity === 'legendary' ? 'L' : c.rarity[0]!.toUpperCase()}${c.level}`
}

export function offerLeft(o: OfferView, now: number): string {
  return o.expiresAt > now ? `${span(o.expiresAt - now)} left` : 'expiring'
}

/** The fee for an offer: each side pays per card it receives (SPEC 8). */
export function tradeFee(cards: number): number {
  return cards * ECONOMY.trade.fee
}

/**
 * The cards the Trader would take for a deal: free to trade, not on the team, plain ones first (no shiny, foil,
 * first find, Mythic or fusion), the lowest value first. Null when there are not enough.
 */
export function traderPicks(deal: TraderDeal, cards: readonly Card[], team: readonly string[], now: number): Card[] | null {
  const fits = cards.filter(c => tradeable(c, now) && !team.includes(c.id) && !c.forTrade
    && (!deal.give.family || c.family === deal.give.family) && (!deal.give.rarity || c.rarity === deal.give.rarity)
    && !c.shiny && !c.foil && !c.firstFind && c.species !== 'mythic' && c.species !== 'fusion')
  const dupes = (c: Card) => cards.filter(x => x.species === c.species).length
  fits.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || dupes(b) - dupes(a) || cardPower(a) - cardPower(b))
  return fits.length >= deal.give.count ? fits.slice(0, deal.give.count) : null
}

/** `2 Haiku cards → 1 rare Sonnet card`. */
export function dealLine(deal: TraderDeal): string {
  const g = deal.give
  const give = `${g.count} ${dots(g.rarity ?? '', g.family ? FAMILY_INFO[g.family].name : '').replace(' · ', ' ')}${g.rarity || g.family ? ' ' : ''}${g.count === 1 ? 'card' : 'cards'}`
    .replace(/\s+/g, ' ')
  const get = deal.get.kind === 'pack'
    ? plural(deal.get.count, `${FAMILY_INFO[deal.get.family].name} pack`)
    : `${deal.get.count} ${deal.get.rarity} ${FAMILY_INFO[deal.get.family].name} ${deal.get.count === 1 ? 'card' : 'cards'}`
  return `${give} → ${get}`
}

// ---------- the daily hello (SPEC 13.11) ----------

export function hello(now: number): { rule: string; text: string; featured: Species | null } {
  const rule = RULE_INFO[dailyRule(now)]
  let featured: Species | null = null
  try {
    featured = getSpecies(featuredSpecies(now)) ?? null
  } catch {
    featured = null
  }
  return { rule: rule.name, text: rule.text, featured }
}

// ---------- reveals ----------

export function revealTitle(r: Reveal): string {
  switch (r.kind) {
    case 'pack': return r.family ? `${FAMILY_INFO[r.family].name} pack` : 'A pack'
    case 'present': return 'A present!'
    case 'egg': return r.cards[0]?.species === 'promo' ? 'An egg from a drop' : 'A new hybrid is hatching'
    case 'craft': return 'Crafted'
    case 'trader': return 'The Wandering Trader\'s side of the deal'
    case 'redeem': return 'Your drop'
    case 'bounty': return 'A card spins out of their corner'
  }
}

/** `+1 Sonnet pack` for packs a drop or a deal gave alongside. */
export function packsLine(packs: Reveal['packs']): string {
  if (packs.length === 0) return ''
  const by = new Map<Family, number>()
  for (const p of packs) by.set(p.family, (by.get(p.family) ?? 0) + 1)
  return '+' + [...by].map(([f, n]) => plural(n, `${FAMILY_INFO[f].name} pack`)).join(', ')
}

/** `5 cards · 2 new species · Album 14/36 (+2)` (SPEC 13.5). */
export function revealSummary(r: Reveal): string {
  const fresh = r.fresh.length
  const gained = r.album.after - r.album.before
  return dots(r.cards.length > 0 && plural(r.cards.length, 'card'), fresh > 0 && plural(fresh, 'new species', 'new species'),
    r.cards.length > 0 && `Album ${r.album.after}/${r.album.total}${gained > 0 ? ` (+${gained})` : ''}`, packsLine(r.packs))
}

/** What a single-card reveal says once it lands. */
export function revealLine(r: Reveal, c: Card): string {
  switch (r.kind) {
    case 'egg': return c.species === 'promo' ? dots('Hatched!', c.form?.stamp ? safe(c.form.stamp, 40) : '') : 'Nobody has ever seen this creature.'
    case 'present': return `${nameOf(c)} is yours now.`
    case 'craft': return `${nameOf(c)} joins your collection.`
    case 'bounty': return `Bounty! ${nameOf(c)} joins your collection.`
    default: return `Gotcha! ${nameOf(c)} joined your collection.`
  }
}

// ---------- account ----------

/** When a new handle can be drawn: '' now, else the day it can. */
export function rerollWhen(from: string, now: number): string {
  const t = Date.parse(from + 'T00:00:00Z')
  if (!Number.isFinite(t) || t <= now) return ''
  return t - now < 2 * DAY ? 'tomorrow' : `on ${safe(from, 10)}`
}

export function today(now: number): string {
  return utcDay(now)
}

/** The hooks this mod registers, for /spin privacy (SPEC 12): never tool.call, prompt.submit or a permission request. */
export const HOOKS = [
  'session.start', 'session.end', 'turn.start', 'turn.step', 'turn.complete', 'agent.spawn', 'session.measure',
  'session.compact', 'command.run', 'ui.close', 'ui.render',
] as const

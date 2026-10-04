// What every offline operation shares: the context it runs in (one clock reading, crypto randomness, fresh ids), the
// refusals, minting cards into the save, packs, room in the collection, and the player's own view. All of it plays by
// the shared core rules; nothing here is a rule of its own beyond keeping the save tidy.
import type { ApiErrorCode, MeResponse, NoticeKind, PackSource, PackView } from '../../core/api.ts'
import type { Card, Family, NewCard, Rng } from '../../core/types.ts'
import { cardStats } from '../../core/cards.ts'
import { ECONOMY, chargeSpacingMs, isRested, leagueOf } from '../../core/economy.ts'
import { SPECIES_ID } from '../../core/species.ts'
import type { SeasonCatalog } from '../../core/species.ts'
import { DAY_MS, utcDay } from '../../core/world.ts'
import { BackendError } from '../types.ts'
import type { LocalPack, LocalState } from './save.ts'
import { LIMITS } from './save.ts'

const B = ECONOMY.battle

export type Ctx = {
  catalog?: SeasonCatalog
  /** one clock reading for the whole operation */
  now: number
  /** crypto-backed (SPEC 28) */
  rng: Rng
  /** a fresh random id */
  id(): string
}

/** The offline player has no identity (SPEC 28): every save answers to this one name. */
export const OFFLINE_HANDLE = 'offline'

export const TEXT = {
  online: 'This needs the online world',
  full: 'Your collection is full · recycle a few old commons to make room',
  storeFull: 'There is no room left to save · recycle a few old commons first',
  nearFull: 'Your collection is nearly full · recycle a few of your oldest commons to make room',
  unreadable: 'The offline save could not be read · /spin privacy can clear it',
  newer: 'This save is from a newer Spinlings · claude plugin update spinlings@spinlings',
  stumbled: 'The offline world stumbled · try that again',
} as const

/** A refusal in plain words. Status 0: nothing went over a network, so nothing here ever reads as unreachable. */
export function refuse(code: ApiErrorCode, message: string): never {
  throw new BackendError(code, 'refused', 0, message)
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz234567'

/** 10 random base32 characters (50 bits): distinct from every online id, which the server makes 128 bits long. */
export function randomId(rng: Rng): string {
  let s = ''
  for (let i = 0; i < 10; i++) s += ID_CHARS[Math.floor(rng() * 32) & 31]
  return s
}

// ---------- cards ----------

export function ownCard(s: LocalState, cardId: string): Card {
  return s.cards.find(c => c.id === cardId) ?? refuse('not_found', 'That card is not in your collection')
}

/** Fusing and recycling: not held, not bound (starters stay for good). */
export function mustBeFree(c: Card): void {
  if (c.state !== 'owned') refuse('not_allowed', 'That card is held right now')
  if (c.bound) refuse('not_allowed', 'That card stays with you for good')
}

/** Room for `adding` more cards: packs, crafts and deals stop at the soft limit, battle rewards at the hard one. */
export function hasRoom(s: LocalState, adding: number, earned = false): boolean {
  return s.cards.length + adding <= (earned ? LIMITS.hardCards : LIMITS.cards)
}

/** Refuses what would grow a full collection; anything that shrinks it is always allowed. */
export function needRoom(s: LocalState, adding: number): void {
  if (adding > 0 && !hasRoom(s, adding)) refuse('cap_reached', TEXT.full)
}

/**
 * Mints fresh cards into the save, the one place a card comes into being offline: a random id, stats from the rules,
 * the album entry for a season species. Offline nothing is ever first in the world.
 */
export function addCards(s: LocalState, ctx: Ctx, fresh: readonly NewCard[], o: { lockedUntil?: number; bound?: boolean } = {}): Card[] {
  const out = fresh.map(c => {
    const { firstFind: _, ...rest } = c as NewCard & { firstFind?: true }
    const card: Card = {
      ...rest, id: ctx.id(), bound: c.bound || o.bound === true, forTrade: false,
      lockedUntil: Math.max(c.lockedUntil, o.lockedUntil ?? 0), tiredUntil: 0, state: 'owned',
    }
    card.stats = cardStats(card, ctx.catalog)
    return card
  })
  s.cards.push(...out)
  for (const c of out) if (SPECIES_ID.test(c.species) && !s.seen.includes(c.species)) s.seen.push(c.species)
  if (out.length) s.cardsVersion++
  return out
}

/** Consumed cards (fusion parents, recycling, Trader payments) leave the collection, the team and the arena counts. */
export function removeCards(s: LocalState, ids: readonly string[]): void {
  const gone = new Set(ids)
  s.cards = s.cards.filter(c => !gone.has(c.id))
  s.team = s.team.filter(x => !gone.has(x))
  for (const x of ids) delete s.arena[x]
  s.cardsVersion++
}

// ---------- packs ----------

export function grantPack(s: LocalState, ctx: Ctx, family: Family, source: PackSource, o: { lockUntil?: number; bound?: boolean } = {}): PackView {
  const pack: LocalPack = { id: ctx.id(), family, source, day: utcDay(ctx.now), lockUntil: o.lockUntil ?? 0, bound: o.bound === true }
  s.packs.push(pack)
  return packView(pack)
}

export const packView = (p: LocalPack): PackView => ({ id: p.id, family: p.family, source: p.source, day: p.day })

/** Unopened packs, oldest first; the wire carries at most 50 (the rest wait their turn). */
export const packsView = (s: LocalState): PackView[] => s.packs.slice(0, 50).map(packView)

// ---------- notices ----------

export function addNotice(s: LocalState, ctx: Ctx, kind: NoticeKind, text: string): void {
  s.notices = [...s.notices, { id: ctx.id(), day: utcDay(ctx.now), kind, text }].slice(-LIMITS.notices)
}

// ---------- pacing (the same spacing as online, for game feel; SPEC 28) ----------

export const recentCharges = (s: LocalState, now: number): number[] => s.charges.filter(t => t > now - DAY_MS)
export const nextWildAt = (s: LocalState): number => (s.lastWildAt ? s.lastWildAt + B.wildSpacingMs : 0)
export const nextDuelAt = (s: LocalState): number => (s.lastDuelAt ? s.lastDuelAt + B.duelSpacingMs : 0)
export const nextChargeAt = (s: LocalState, now: number): number =>
  s.lastChargeAt ? s.lastChargeAt + chargeSpacingMs(recentCharges(s, now).length) : 0

// ---------- the player's view ----------

export function meView(s: LocalState, now: number): MeResponse {
  const ids = new Set(s.cards.map(c => c.id))
  return {
    player: {
      handle: OFFLINE_HANDLE, handleRerollFrom: utcDay(now), sparks: s.sparks, rating: s.rating, league: leagueOf(s.rating).name,
      leaderboard: false, joinedDay: s.joined, battles: s.battles, canTrade: false, team: s.team.filter(x => ids.has(x)),
      wishlist: [], cardsVersion: s.cardsVersion, streak: s.streak, seen: s.seen.slice(-5000),
      rested: isRested(Math.max(s.lastWildAt, s.lastDuelAt), now), nextWildAt: nextWildAt(s), nextDuelAt: nextDuelAt(s),
      nextChargeAt: nextChargeAt(s, now),
    },
    packs: packsView(s),
    notices: [...s.notices].reverse(),
    offers: { incoming: [], outgoing: [] },
    gifts: [],
    now,
  }
}

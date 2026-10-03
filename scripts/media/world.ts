// The game states the recordings draw: a player a few days in, minted by the core's own rules from fixed seeds, so
// every run draws the same creatures. Nothing here is invented art: cards come from mintCard, starterTeam and
// generateMythic, battles from simulateBattle, words from the views.
import type { Card, Family, NewCard, Rarity } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION } from '../../plugin/hooks/core/battle.ts'
import { mintCard, starterTeam, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { FEATURES } from '../../plugin/hooks/core/api.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { familySpecies, legendaryOf } from '../../plugin/hooks/core/species.ts'
import { DAILY_RULES, dailyRule, seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import type { Battle, GameState } from '../../plugin/hooks/client/types.ts'

const MIN = 60_000
const DAY = 86_400_000

/** The first day of season 1 whose daily rule is `rule`, at noon UTC. */
export function dayWith(rule: (typeof DAILY_RULES)[number], from = Date.UTC(2026, 9, 2, 12)): number {
  for (let t = from; t < from + 60 * DAY; t += DAY) if (dailyRule(t) === rule && seasonOf(t) === 1) return t
  return from
}

export type Media = ReturnType<typeof mediaWorld>

export function mediaWorld(now: number, seed = 'spinlings/media') {
  const season = seasonOf(now)
  const rng = rngFromSeed(seed)
  let n = 0
  const id = (c: NewCard, extra: Partial<Card> = {}): Card => ({ ...c, id: `m-${++n}`, ...extra })
  const mint = (family: Family, index: number, rarity: Rarity, extra: Partial<Card> = {}, level = 1, dna = Math.floor(rng() * 2 ** 32)): Card => {
    const species = rarity === 'legendary' ? legendaryOf(season, family) : familySpecies(season, family)[index]!
    return id(mintCard({ species, rarity, shiny: false, dna, origin: 'pack', now: now - n * MIN, level }), extra)
  }
  const starters = starterTeam('opus', rng, now - 3 * DAY).map(c => id(c, { tiredUntil: 0 }))
  const base: GameState = {
    ...INITIAL,
    account: { ...INITIAL.account, link: 'ready', features: [...FEATURES], devices: { sessions: 1, passkeys: 0 } },
    me: {
      player: {
        handle: 'brave-wren-41', handleRerollFrom: utcDay(now), sparks: 340, rating: 1312, league: 'Grove', leaderboard: false,
        joinedDay: utcDay(now - 9 * DAY), battles: 48, canTrade: true, team: starters.map(c => c.id), wishlist: [],
        cardsVersion: 7, streak: 2, seen: [...new Set(starters.map(c => c.species))], rested: false,
        nextWildAt: 0, nextDuelAt: 0, nextChargeAt: 0,
      },
      packs: [],
      notices: [],
      offers: { incoming: [], outgoing: [] },
      gifts: [],
      now,
    },
    cards: starters,
    signals: { ...INITIAL.signals, family: 'opus', working: true, turnStartedAt: now - 40_000 },
    presence: { minutes: 32, need: 50, blocked: null },
    clock: now,
  }
  return { now, season, rng, mint, id, starters, base }
}

/** A battle in the shape the game keeps it, against `defender`, on the battle seed `seed`. */
export function battleOf(w: Media, o: { seed: string; defender: Card[]; kind?: 'wild' | 'duel'; first?: boolean; attacker?: Card[] }): Battle {
  const kind = o.kind ?? 'wild'
  return {
    id: `media-${o.seed}`,
    setup: { seed: o.seed, kind, arena: 'opus', rule: dailyRule(w.now), rules: RULES_VERSION, attacker: (o.attacker ?? w.starters).map(toBattleCard), defender: o.defender.map(toBattleCard) },
    opponent: kind === 'wild' ? { kind: 'wild' } : { kind: 'rival', name: 'Thistlewick', league: 'Grove' },
    subs: [], firstPossible: o.defender.map(() => !!o.first), startedAt: w.now, finishAfter: w.now + 30_000,
    live: true, phase: 'rustle', shown: 0, inputs: [], log: null,
  }
}

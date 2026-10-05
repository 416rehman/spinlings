// Every tunable number from SPEC.md in one place, plus the small pacing rules built on them.
// There are no per-day quotas anywhere (SPEC section 24), and no account limits on trading: abuse is bounded by pace,
// pair limits, escrow and sinks, and storage sizes keep tables small.
import type { LeagueName, Rarity } from './types.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const ECONOMY = {
  stats: {
    budget: 100,
    jitter: 8,
    legendaryBase: 1.15,
    /** Mythics: on top of the legendary base */
    mythicBase: 1.1,
    geneBase: 0.88,
    genePerPoint: 0.016,
    rarityMult: { common: 1, rare: 1.08, epic: 1.18, legendary: 1.3 } as Record<Rarity, number>,
    levelStep: 0.07,
    /** by stage 1, 2, 3 */
    stageMult: [1, 1.15, 1.3] as const,
  },
  /** evolveAt: the levels at which stage 2 and stage 3 are reached */
  levels: { max: 10, xpPerLevel: 40, evolveAt: [4, 8] as const },
  cosmetics: { hueShift: 18, lightShift: 0.06, satShift: 0.08, defaultPattern: 0.8, trinket: 0.05 },
  shiny: { chance: 1 / 100, hourChance: 1 / 25, hourStartUtc: 18 },
  /** a separate holographic finish on any rarity; legendaries and Mythics are always foil */
  foil: { chance: 1 / 16 },
  /** every 3rd consecutive win pays a streak pack, with no daily limit; battle spacing is the only pace (SPEC 14, 24) */
  streak: { every: 3 },
  /** rating floors, lowest first; season-end reward packs by league */
  leagues: [
    { name: 'Pebble', min: 0, seasonPacks: 1 },
    { name: 'Brook', min: 1100, seasonPacks: 2 },
    { name: 'Grove', min: 1300, seasonPacks: 3 },
    { name: 'Peak', min: 1500, seasonPacks: 4 },
    { name: 'Star', min: 1700, seasonPacks: 5 },
  ] as readonly { name: LeagueName; min: number; seasonPacks: number }[],
  /** season end: rating soft-resets to 1000 + (rating - 1000) / 2 */
  seasonReset: 0.5,

  battle: {
    roundLimit: 20,
    longDayRoundLimit: 30,
    chargeNeed: 2,
    /** a Perfect special: the player pressed on the round it fired */
    perfect: 1.3,
    variance: [0.85, 1] as const,
    crit: 1.5,
    glassCrit: 2,
    critChance: 1 / 16,
    luckyCritChance: 1 / 8,
    arena: 1.1,
    homebodyArena: 1.2,
    typeStrong: 1.5,
    typeWeak: 0.67,
    sparks: { win: 10, duelWin: 12, draw: 5, loss: 3 },
    revengeBonus: 5,
    xp: { win: 20, draw: 12, loss: 8 },
    catchChance: 0.6,
    wildBloomCatchChance: 0.8,
    bountyChance: 0.2,
    defenseSparks: 4,
    /** defense sparks and rating move only for the first `pairLimit` duels between two accounts per `pairWindowMs` */
    pairLimit: 3,
    pairWindowMs: DAY,
    /** server pacing: a wild start at least 8 minutes after the previous wild start, a duel 2 minutes */
    wildSpacingMs: 8 * MIN,
    duelSpacingMs: 2 * MIN,
    /** finish is refused sooner than rounds x this after start */
    minRoundMs: 1500,
    tiredMs: 15 * MIN,
    /** encounters: once Claude's main turn has run 20 s, every further 15 s rolls 30% */
    encounterAfterMs: 20_000,
    encounterEveryMs: 15_000,
    encounterChance: 0.3,
    duelChance: 0.4,
    duelCooldownMs: 20 * MIN,
    abandonMs: 10 * MIN,
    catchWindowMs: 10 * MIN,
    catchAutoPickMs: 20_000,
    resultBandMs: 12_000,
    /** every round plays at this pace, the same for everyone (SPEC 5, 20.2) */
    roundMs: 2200,
  },

  traits: {
    swift: 1.15, thickHide: 0.9, glassAtk: 1.2, glassHp: 0.85, regrowth: 0.06, underdogBelow: 0.3, underdog: 1.25,
    ambush: 1.3, moonlit: 0.25, showoff: 1.25, guardian: 1.15, sleepySpd: 0.9, sleepyHp: 1.15,
  },
  specials: { flurry: 0.9, couplet: 1.5, coupletHeal: 0.15, crescendo: 2.1, twist: 1.6 },
  daily: { haikuSpd: 1.2, sonnetHeal: 0.04, opusAtk: 1.15, gentle: 0.85 },

  wild: {
    size: [[1, 20], [2, 35], [3, 45]] as [number, number][],
    arena: 0.5,
    featured: 0.15,
    rarity: [['common', 78], ['rare', 18], ['epic', 4]] as [Rarity, number][],
    levelSpread: 1,
    roamerChance: 0.01,
    mythicChance: 1 / 40,
    /** after this long without a battle the next wild lead is rare or better */
    restedMs: 4 * HOUR,
    restedRarity: [['rare', 18], ['epic', 4]] as [Rarity, number][],
    /** beginner's luck: the first wild encounter ever is one common at this level, or two below the team's if lower */
    firstLevel: 1,
  },

  rating: { start: 1000, floor: 0, k: 32, windows: [150, 400], recentOpponents: 5, seenWithinMs: 14 * DAY },

  /** Rival trainers fill in for real duel opponents; they are sized to the player's team power and rating */
  rival: { ratingSpread: 50, scaleAt: 1000, scalePer400: 0.08, minScale: 0.85, maxScale: 1.25 },

  packs: {
    size: 2,
    odds: [['common', 70], ['rare', 22], ['epic', 7], ['legendary', 1]] as [Rarity, number][],
    lastSlotOdds: [['rare', 75], ['epic', 21], ['legendary', 4]] as [Rarity, number][],
    presenceMinutes: 50,
    chargeSpacingMs: 45 * MIN,
    /** beyond this many charges in any rolling 24 hours, the spacing doubles */
    fastCharges: 16,
    /** unopened packs held at once: a storage size, not a quota */
    bank: 12,
    buyCost: 150,
    welcome: 2,
  },

  sparks: { start: 100, dailyHello: 10 },
  /** well under the pack price: a bought pack's two cards recycle for less than its 150 sparks on average */
  recycle: { common: 4, rare: 15, epic: 60, legendary: 250 } as Record<Rarity, number>,
  recycleShiny: 2,
  recycleFoil: 1.5,
  recycleMythic: 2,
  craft: { common: 50, rare: 200, epic: 800, legendary: 3200 } as Record<Rarity, number>,
  fusion: { cost: 40, fairCost: 20, tierUp: 0.15, geneNoise: 2 },
  /** starters sit 20 xp short of level 4: one good battle from their first evolution */
  starter: { level: 3, xp: 100 },
  /** offline only: the offline world's welcome cards stay put this long (online cards are never locked, SPEC 8) */
  welcomeLockMs: 7 * DAY,

  /**
   * Offers. `openOutgoing` is a storage size, not a quota. The online server charges no fee, has no trust gate and
   * locks no card (SPEC 8): `fee`, `minAgeMs`, `minBattles` and `lockMs` are the 0.1.0 rules, kept only while the
   * 0.1.0 mod's own screens still quote them; nothing on the server reads them.
   */
  trade: {
    openOutgoing: 50, maxGive: 3, maxGet: 3, expiryMs: 72 * HOUR,
    /** @deprecated 0.1.0 only */ fee: 10,
    /** @deprecated 0.1.0 only */ minAgeMs: 3 * DAY,
    /** @deprecated 0.1.0 only */ minBattles: 10,
    /** @deprecated 0.1.0 only */ lockMs: 24 * HOUR,
  },
  /**
   * The market (SPEC 8): a listing waits `ttlMs` (to the first UTC midnight after), `open` listings per player at once
   * (storage), prices in whole sparks up to `maxPrice`, `page` listings a page and the last `recentSales` sale prices
   * per species. No fee.
   */
  market: { ttlMs: 14 * DAY, open: 100, maxPrice: 1_000_000, page: 50, recentSales: 5 },
  /** Leaderboards (SPEC 8): the top `size` of each board, plus the caller's own rank. */
  boards: { size: 50 },
  /** the giver's bonus pack pays once the claimant has finished `bonusBattles` battles on `bonusDays` different days */
  gift: { ttlMs: 14 * DAY, open: 10, claimsPerHour: 5, bonusBattles: 5, bonusDays: 2 },
  wishlistMax: 5,
  boardMatches: 20,
  teamSize: 3,
  /** the Trader's stock: 3 deals, each usable once per player per UTC day (a rotating shop, not a cap on play) */
  trader: { deals: 3 },
  handleRerollMs: 7 * DAY,

  /** shared by the mod and the server: how long a sign-in poll lives, and how long an unused session lasts */
  server: { pollTtlMs: 10 * MIN, sessionIdleMs: 180 * DAY },
  client: { responseMaxBytes: 256 * 1024, privacyLog: 20, pollEveryMs: 2000 },
} as const

export type League = (typeof ECONOMY.leagues)[number]

export function leagueOf(rating: number): League {
  let league = ECONOMY.leagues[0]!
  for (const l of ECONOMY.leagues) if (rating >= l.min) league = l
  return league
}

/** Season end: packs by the final league, a foil legendary for Star, and the soft-reset rating. */
export function seasonEnd(rating: number): { league: LeagueName; packs: number; legendary: boolean; rating: number } {
  const league = leagueOf(rating)
  return {
    league: league.name,
    packs: league.seasonPacks,
    legendary: league.name === 'Star',
    rating: Math.round(ECONOMY.rating.start + (rating - ECONOMY.rating.start) * ECONOMY.seasonReset),
  }
}

/** The rested bonus (SPEC section 17): no battle for 4 hours makes the next wild lead rare or better. */
export function isRested(lastBattleAt: number, now: number): boolean {
  return now - lastBattleAt >= ECONOMY.wild.restedMs
}

/**
 * Beginner's luck (SPEC 13): a player who has never won a wild battle and has no wild start on record meets a gentle
 * first creature (rollFirstWild). `lastWildAt` is 0 for never.
 */
export function firstWildDue(wildWon: boolean, lastWildAt: number): boolean {
  return !wildWon && lastWildAt === 0
}

/** Server spacing before the next pack charge: 45 minutes, doubled beyond 16 charges in the last 24 hours. */
export function chargeSpacingMs(chargesInLast24h: number): number {
  return ECONOMY.packs.chargeSpacingMs * (chargesInLast24h >= ECONOMY.packs.fastCharges ? 2 : 1)
}

/** The earliest a battle of `rounds` rounds may be finished (SPEC section 15). */
export function finishAfter(startedAt: number, rounds: number): number {
  return startedAt + rounds * ECONOMY.battle.minRoundMs
}

/** Whether a duel moves rating and pays defense sparks, given the pair's earlier finished duels in the window. */
export function pairCounts(earlierPairDuels: number): boolean {
  return earlierPairDuels < ECONOMY.battle.pairLimit
}

/**
 * @deprecated The 0.1.0 trust gate. The online server no longer has one (SPEC 8, 30): every online account may trade,
 * list and send gifts. Kept for the 0.1.0 mod's screens only.
 */
export function canTrade(joinedAt: number, battles: number, now: number): boolean {
  return now - joinedAt >= ECONOMY.trade.minAgeMs && battles >= ECONOMY.trade.minBattles
}

/** The giver's bonus pack: the claimant joined after the gift and has really played since. */
export function giftBonusDue(claimantBattles: number, claimantBattleDays: number): boolean {
  return claimantBattles >= ECONOMY.gift.bonusBattles && claimantBattleDays >= ECONOMY.gift.bonusDays
}

export function streakPackDue(streak: number): boolean {
  return streak > 0 && streak % ECONOMY.streak.every === 0
}

export function canRerollHandle(lastRerollAt: number, now: number): boolean {
  return now - lastRerollAt >= ECONOMY.handleRerollMs
}

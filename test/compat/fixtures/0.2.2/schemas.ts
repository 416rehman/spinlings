// The 0.2.2 mod's response reader, frozen for test/compat/replay.test.ts (SPEC 32): plugin/hooks/core/schemas.ts
// as 0.2.2 shipped it, written by scripts/compat-record.ts. Only the imports differ (values written in, types and
// functions from the live modules), and the other checks of client/net.ts readAnswer follow at the end. Never edit it.

// A tiny validator, and a schema for every wire and domain shape (SPEC sections 12 and 32).
// - Requests are parsed STRICTLY by the server: unknown keys, wrong types, bad formats and out-of-range numbers all
//   throw a SchemaError naming the path. No request schema accepts card data (SPEC section 28).
// - Responses are read TOLERANTLY by the client: types, formats and ranges of known fields are still checked, but
//   unknown keys are stripped and an unknown enum value maps to a safe fallback, so a newer server never breaks an
//   older mod.
// Every parse returns a fresh object.
import type {
  ApiError, ApiOp, AuthPollResponse, AuthStartResponse, BoardResponse, BuyPackRequest, BuyRequest, BuyResponse,
  CardResponse, CardsResponse, CatchRequest, ChallengeResponse, ChargeRequest, ClaimRequest, CounterRequest,
  CraftRequest, DeleteResponse, DevicesResponse, EmptyRequest, FinishBattleRequest, FinishBattleResponse,
  ForTradeRequest, FuseRequest, FuseResponse, GiftRequest, GiftResponse, GiftView, HandleRequest, HandleResponse, JoinRequest,
  JoinResponse, LeaderboardOptRequest, LeaderboardOptResponse, LeaderboardResponse, ListCardRequest, ListingResponse,
  ListingView, MarketResponse, MarketWant, MeResponse, Notice, OfferRequest, OfferResponse, OfferView, OpenPackRequest,
  OpenPackResponse, PacksResponse, PackView, PlayerStats, PlayerView, ProfileResponse, RankingsResponse, RankRow,
  RecycleResponse, RedeemRequest, RedeemResponse, SaleView, SeasonResponse, StartBattleRequest, StartBattleResponse,
  TeamRequest, TeamResponse, TokenResponse, TraderDealRequest, TraderDealResponse, TraderDealView, TraderResponse,
  VersionResponse, WishlistRequest, WishlistResponse, WorldResponse,
} from '../../../../plugin/hooks/core/api.ts'
import type {
  BattleAction, BattleCard, BattleLog, BattleRound, BattleSetup, Card, CardForm, CardOrigin, DropReward, DropRewardItem, Form, Genes,
  PromoEgg, Species, Stats, TraderDeal,
} from '../../../../plugin/hooks/core/types.ts'
import { wantProblem } from '../../../../plugin/hooks/core/market.ts'
import { isBlocked } from '../../../../plugin/hooks/core/naming.ts'
const SPECIES_ID = /^s([1-9]\d{0,3})-(haiku|sonnet|opus|fable)-([0-8])$/

export class SchemaError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SchemaError'
    this.path = path
  }
}

export type Schema<T> = (value: unknown, path: string) => T
type Optional = { optional: Schema<unknown> }
type Field = Schema<unknown> | Optional

function fail(path: string, message: string): never {
  throw new SchemaError(path, message)
}

function kindOf(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
}

// ---------- combinators ----------

function str(o: { max: number; min?: number; re?: RegExp }): Schema<string> {
  return (v, path) => {
    if (typeof v !== 'string') return fail(path, `expected string, got ${kindOf(v)}`)
    if (v.length > o.max) return fail(path, `longer than ${o.max}`)
    if (v.length < (o.min ?? 0)) return fail(path, `shorter than ${o.min}`)
    if (o.re && !o.re.test(v)) return fail(path, 'bad format')
    return v
  }
}

function int(min: number, max: number): Schema<number> {
  return (v, path) => {
    if (typeof v !== 'number' || !Number.isInteger(v)) return fail(path, `expected integer, got ${kindOf(v)}`)
    if (v < min || v > max) return fail(path, `out of range ${min}..${max}`)
    return v
  }
}

function num(min: number, max: number): Schema<number> {
  return (v, path) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(path, `expected number, got ${kindOf(v)}`)
    if (v < min || v > max) return fail(path, `out of range ${min}..${max}`)
    return v
  }
}

const bool: Schema<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, `expected boolean, got ${kindOf(v)}`))

/** One of `values`. With a fallback (tolerant reading), any other string becomes the fallback; other types still fail. */
function oneOf<T extends string | number | boolean>(values: readonly T[], fallback?: T): Schema<T> {
  return (v, path) => {
    if (values.includes(v as T)) return v as T
    if (fallback !== undefined && typeof v === 'string' && v.length <= 64) return fallback
    return fail(path, `expected one of ${values.join(', ')}`)
  }
}

function arr<T>(item: Schema<T>, o: { max: number; min?: number; unique?: boolean }): Schema<T[]> {
  return (v, path) => {
    if (!Array.isArray(v)) return fail(path, `expected array, got ${kindOf(v)}`)
    if (v.length > o.max) return fail(path, `more than ${o.max} items`)
    if (v.length < (o.min ?? 0)) return fail(path, `fewer than ${o.min} items`)
    const out = v.map((x, i) => item(x, `${path}[${i}]`))
    if (o.unique && new Set(out).size !== out.length) return fail(path, 'duplicate items')
    return out
  }
}

function tuple<T extends unknown[]>(...items: { [K in keyof T]: Schema<T[K]> }): Schema<T> {
  return (v, path) => {
    if (!Array.isArray(v)) return fail(path, `expected array, got ${kindOf(v)}`)
    if (v.length !== items.length) return fail(path, `expected ${items.length} items`)
    return items.map((s, i) => (s as Schema<unknown>)(v[i], `${path}[${i}]`)) as T
  }
}

function nullable<T>(s: Schema<T>): Schema<T | null> {
  return (v, path) => (v === null ? null : s(v, path))
}

function optional<T>(s: Schema<T>): Optional {
  return { optional: s as Schema<unknown> }
}

function record<T>(shape: Record<string, Field>, tolerant: boolean, check?: (v: T) => string | null): Schema<T> {
  const keys = Object.keys(shape)
  return (v, path) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, `expected object, got ${kindOf(v)}`)
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return fail(path, 'expected a plain object')
    if (!tolerant) for (const k of Object.keys(v)) if (!Object.hasOwn(shape, k)) fail(`${path}.${k}`, 'unknown key')
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      const field = shape[k]!
      const present = Object.hasOwn(src, k) && src[k] !== undefined
      if (typeof field === 'function') {
        if (!present) fail(`${path}.${k}`, 'missing')
        out[k] = field(src[k], `${path}.${k}`)
      } else if (present) out[k] = field.optional(src[k], `${path}.${k}`)
    }
    const problem = check?.(out as T)
    if (problem) fail(path, problem)
    return out as T
  }
}

/** A strict object (requests and admin data): exactly these keys, optional ones may be absent. Unknown keys throw. */
function obj<T>(shape: Record<string, Field>, check?: (v: T) => string | null): Schema<T> {
  return record(shape, false, check)
}

/** A tolerant object (responses): known keys are checked, unknown keys are dropped. */
function view<T>(shape: Record<string, Field>, check?: (v: T) => string | null): Schema<T> {
  return record(shape, true, check)
}

/** Objects told apart by a literal `key`. With a fallback (tolerant reading), an unknown tag yields the fallback value. */
function union<T>(key: string, variants: Record<string, Schema<unknown>>, fallback?: () => T): Schema<T> {
  return (v, path) => {
    const tag = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined
    if (typeof tag === 'string' && Object.hasOwn(variants, tag)) return variants[tag]!(v, path) as T
    if (fallback && typeof tag === 'string') return fallback()
    return fail(`${path}.${key}`, 'unknown variant')
  }
}

export function parse<T>(schema: Schema<T>, value: unknown): T {
  return schema(value, '$')
}

/** The combinators, for building more schemas elsewhere. */
export const S = { str, int, num, bool, oneOf, arr, tuple, nullable, optional, obj, view, union }

// ---------- formats ----------

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const HANDLE_RE = /^[A-Za-z0-9_-]{1,40}$/
export const GIFT_CODE_RE = /^[a-z]{2,12}-[a-z]{2,12}-[a-z]{2,12}-\d{4}$/
export const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
/** One or two title-case words, or a word and a roman numeral: Pipkin, Thundermaw II, Hollowmere Duskwing */
export const NAME_RE = /^[A-Z][a-z]{2,23}(?: (?:[A-Z][a-z]{2,23}|[IVXLCDM]{1,12}))?$/
export const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/
/** what a player types for a drop; normalizeDropCode makes it comparable */
export const DROP_CODE_RE = /^[A-Za-z0-9]+(?:[- ][A-Za-z0-9]+)*$/
export const TRADER_DEAL_RE = /^\d{4}-\d{2}-\d{2}-\d$/
/** a page cursor (CardsResponse.next, MarketResponse.next): opaque to the mod, which only sends it back as `?after=` */
export const CURSOR_RE = /^[A-Za-z0-9._~-]{1,64}$/
export const CARD_SPECIES_RE = /^(?:s[1-9]\d{0,3}-(?:haiku|sonnet|opus|fable)-[0-8]|fusion|mythic|promo)$/
const PLAIN_TEXT_RE = /^[^\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]*$/
const TOKEN_RE = /^[A-Za-z0-9_-]+$/
const URL_RE = /^https?:\/\/[^\s"'<>\\]+$/

const MAX_TIME = 8.64e15
const id = str({ max: 64, re: ID_RE })
const handle = str({ max: 40, re: HANDLE_RE })
const day = str({ max: 10, re: DAY_RE })
const speciesId = str({ max: 16, re: SPECIES_ID })
const cardSpecies = str({ max: 16, re: CARD_SPECIES_RE })
const name = str({ max: 48, re: NAME_RE })
const time = int(0, MAX_TIME)
const count = int(0, 1e9)
const text = (max: number) => str({ max, re: PLAIN_TEXT_RE })
const giftCode = str({ max: 48, re: GIFT_CODE_RE })
const token = str({ min: 20, max: 128, re: TOKEN_RE })

const FAMILY_VALUES = ['haiku', 'sonnet', 'opus', 'fable'] as const
const RARITY_VALUES = ['common', 'rare', 'epic', 'legendary'] as const
const TRAIT_VALUES = [
  'sturdy', 'swift', 'thickHide', 'luckyStar', 'quickCharge', 'glassHeart', 'regrowth', 'underdog',
  'ambush', 'moonlit', 'stubborn', 'showoff', 'guardian', 'sleepy', 'homebody', 'mimic',
] as const
const RULE_VALUES = ['haikuDay', 'sonnetDay', 'opusDay', 'fableDay', 'topsyTurvy', 'glassDay', 'longDay', 'gentleDay', 'wildBloom', 'shinyHour', 'fusionFair', 'calm'] as const
const LEAGUE_VALUES = ['Pebble', 'Brook', 'Grove', 'Peak', 'Star'] as const

/** Families stay strict everywhere: a new family would be a breaking change (/v2). */
const family = oneOf(FAMILY_VALUES)
const rarity = oneOf(RARITY_VALUES)
const rarityView = oneOf(RARITY_VALUES, 'common')
const ruleView = oneOf(RULE_VALUES, 'calm')
const leagueView = oneOf(LEAGUE_VALUES, 'Pebble')
/** an unknown trait survives as its id: shown by name with no effect line, and it does nothing in a local battle */
const traitView = str({ max: 24, re: /^[A-Za-z]+$/ }) as Schema<(typeof TRAIT_VALUES)[number]>
const gene = int(0, 15)
const rating = int(0, 100_000)
/** whole sparks a market listing asks (ECONOMY.market.maxPrice) */
const price = int(1, 1_000_000)

// ---------- domain (read tolerantly) ----------

export const statsSchema = view<Stats>({ hp: num(1, 500), atk: num(1, 500), def: num(1, 500), spd: num(1, 500) })
/** a card's server-computed stats: whole numbers */
export const cardStatsSchema = view<Stats>({ hp: int(1, 9999), atk: int(1, 9999), def: int(1, 9999), spd: int(1, 9999) })
export const genesSchema = tuple<Genes>(gene, gene, gene, gene)

const formShape: Record<string, Field> = {
  family,
  body: oneOf(['blob', 'critter', 'bird', 'ghost', 'bug', 'wyrm'] as const, 'blob'),
  hue: num(0, 360),
  pattern: oneOf(['none', 'spots', 'stripes', 'belly', 'mask'] as const, 'none'),
  accessory: oneOf(['horns', 'crown', 'antennae', 'halo', 'spikes', 'wings'] as const, 'horns'),
  base: statsSchema,
  names: tuple<[string, string, string]>(name, name, name),
  legendary: bool,
}
export const formSchema = view<Form>(formShape)
export const speciesSchema = view<Species>({ ...formShape, id: speciesId, season: int(1, 9999), index: int(0, 8) }, s =>
  s.id === `s${s.season}-${s.family}-${s.index}` ? null : 'species id does not match season, family and index')
export const cardFormSchema = view<CardForm>({
  ...formShape,
  kind: oneOf(['fusion', 'mythic', 'promo'] as const),
  parents: optional(tuple<[string, string]>(cardSpecies, cardSpecies)),
  seed: optional(str({ min: 1, max: 64, re: ID_RE })),
  discoveredBy: optional(handle),
  stamp: optional(text(40)),
}, f => (f.kind === 'fusion') !== (f.parents !== undefined) ? 'parents belong to fusions only' : null)

const battleCardShape: Record<string, Field> = {
  id,
  species: cardSpecies,
  form: optional(cardFormSchema),
  season: int(1, 9999),
  family,
  rarity: rarityView,
  shiny: bool,
  foil: optional(oneOf([true] as const)),
  dna: int(0, 0xffffffff),
  genes: genesSchema,
  traits: arr(traitView, { min: 1, max: 4, unique: true }),
  level: int(1, 10),
  stage: oneOf([1, 2, 3] as const),
  raisedIn: optional(family),
  stats: cardStatsSchema,
  firstFind: optional(oneOf([true] as const)),
}

function cardProblem(c: BattleCard): string | null {
  const embedded = c.species === 'fusion' || c.species === 'mythic' || c.species === 'promo'
  if (embedded !== (c.form !== undefined)) return 'a form must be present exactly for fusion, mythic and promo cards'
  if (c.form && c.form.kind !== c.species) return 'form kind must match species'
  if (c.form && c.form.family !== c.family) return 'form family mismatch'
  if (!embedded && c.species.split('-')[1] !== c.family) return 'species family mismatch'
  return null
}

export const battleCardSchema = view<BattleCard>(battleCardShape, cardProblem)

export const cardSchema = view<Card>({
  ...battleCardShape,
  xp: int(0, 400),
  bound: bool,
  forTrade: bool,
  origin: oneOf<CardOrigin>(['starter', 'pack', 'catch', 'bounty', 'craft', 'fusion', 'gift', 'daily', 'trader', 'promo', 'season'], 'unknown'),
  mintedAt: time,
  lockedUntil: time,
  tiredUntil: time,
  state: oneOf(['owned', 'escrow'] as const),
}, cardProblem)

export const battleSetupSchema = view<BattleSetup>({
  seed: str({ min: 1, max: 128, re: /^[A-Za-z0-9:_-]+$/ }),
  kind: oneOf(['wild', 'duel'] as const),
  arena: family,
  rule: ruleView,
  rules: int(1, 1_000_000),
  attacker: arr(battleCardSchema, { min: 1, max: 3 }),
  defender: arr(battleCardSchema, { min: 1, max: 3 }),
})

const slot = int(0, 2)
const sides = <T>(s: Schema<T>) => view<{ a: T; d: T }>({ a: s, d: s })

export const battleActionSchema = view<BattleAction>({
  round: int(1, 30),
  side: oneOf(['a', 'd'] as const),
  slot,
  targetSlot: slot,
  move: oneOf(['attack', 'special'] as const),
  special: optional(oneOf(['flurry', 'couplet', 'crescendo', 'twist'] as const)),
  perfect: optional(oneOf([true] as const)),
  hits: int(0, 4),
  dmg: int(0, 1e6),
  crit: bool,
  effect: oneOf(['super', 'weak', 'normal'] as const, 'normal'),
  heal: int(0, 1e6),
  targetFainted: bool,
  traits: arr(traitView, { max: 16 }),
})

export const battleLogSchema = view<BattleLog>({
  rounds: arr(view<BattleRound>({
    round: int(1, 30),
    actions: arr(battleActionSchema, { max: 2 }),
    hp: sides(arr(int(0, 1e6), { max: 3 })),
    charge: sides(arr(int(0, 4), { max: 3 })),
    active: sides(int(-1, 2)),
    attackerSpecialReady: bool,
  }), { max: 30 }),
  result: oneOf(['win', 'loss', 'draw'] as const),
  maxHp: sides(arr(int(1, 1e6), { max: 3 })),
  fainted: sides(arr(slot, { max: 3 })),
})

const traderDealShape: Record<string, Field> = {
  id: str({ max: 16, re: TRADER_DEAL_RE }),
  name: text(40),
  give: view({ count: int(1, 10), family: optional(family), rarity: optional(rarity) }),
  get: union('kind', {
    cards: view({ kind: oneOf(['cards'] as const), count: int(1, 5), rarity, family }),
    pack: view({ kind: oneOf(['pack'] as const), count: int(1, 5), family }),
  }),
}
export const traderDealSchema = view<TraderDeal>(traderDealShape)
const traderDealViewSchema = view<TraderDealView>({ ...traderDealShape, used: bool })

// ---------- responses (read tolerantly) ----------

export const apiErrorSchema = view<ApiError>({
  error: view({
    code: oneOf([
      'bad_request', 'unauthorized', 'not_found', 'rate_limited', 'cap_reached', 'not_allowed', 'conflict',
      'insufficient_sparks', 'expired', 'too_large', 'unavailable', 'upgrade_required',
    ] as const, 'unavailable'),
    message: text(200),
  }),
})

export const playerStatsSchema = view<PlayerStats>({
  duelWins: count,
  duelLosses: count,
  playersBeaten: count,
  wildWins: count,
  catches: count,
  speciesCollected: count,
  firstFinds: count,
  mythicsFound: count,
  marketSales: count,
})

export const playerViewSchema = view<PlayerView>({
  handle,
  handleRerollFrom: day,
  sparks: count,
  rating,
  league: leagueView,
  leaderboard: bool,
  joinedDay: day,
  battles: count,
  canTrade: bool,
  team: arr(id, { max: 3 }),
  wishlist: arr(speciesId, { max: 5 }),
  cardsVersion: count,
  streak: count,
  seen: arr(speciesId, { max: 5000 }),
  rested: bool,
  nextWildAt: time,
  nextDuelAt: time,
  nextChargeAt: time,
  stats: optional(playerStatsSchema),
})

export const packViewSchema = view<PackView>({
  id,
  family,
  source: oneOf(['welcome', 'charge', 'bought', 'daily', 'bonus', 'streak', 'season', 'trader', 'promo'] as const, 'bonus'),
  day,
})

export const noticeSchema = view<Notice>({
  id,
  day,
  kind: oneOf([
    'defense-win', 'defense-loss', 'evolved', 'gift-claimed', 'gift-returned', 'offer-received', 'offer-accepted',
    'offer-declined', 'offer-expired', 'bonus-pack', 'daily-pack', 'streak-pack', 'season-end', 'new-device',
    'market-sold', 'market-expired', 'notice',
  ] as const, 'notice'),
  text: text(200),
  handle: optional(handle),
})

export const offerViewSchema = view<OfferView>({
  id,
  from: handle,
  to: handle,
  give: arr(battleCardSchema, { max: 3 }),
  get: arr(battleCardSchema, { max: 3 }),
  state: oneOf(['open', 'accepted', 'declined', 'cancelled', 'expired'] as const, 'expired'),
  createdAt: time,
  expiresAt: time,
})

export const giftViewSchema = view<GiftView>({ code: giftCode, card: cardSchema, createdAt: time, expiresAt: time, claimedBy: optional(handle) })

const wantShape: Record<string, Field> = {
  species: optional(speciesId),
  family: optional(family),
  rarity: optional(rarity),
  shiny: optional(oneOf([true] as const)),
  foil: optional(oneOf([true] as const)),
}
/** read tolerantly: a want with a field this mod does not know still shows what it does know */
export const marketWantSchema = view<MarketWant>({ ...wantShape, rarity: optional(rarityView) })
export const listingViewSchema = view<ListingView>({
  id,
  seller: handle,
  card: battleCardSchema,
  price: int(0, 1_000_000),
  want: optional(marketWantSchema),
  day,
  state: oneOf(['open', 'sold', 'cancelled', 'expired'] as const, 'expired'),
})
export const saleViewSchema = view<SaleView>({ day, price, rarity: rarityView, shiny: bool, foil: bool })

export const meResponseSchema = view<MeResponse>({
  player: playerViewSchema,
  packs: arr(packViewSchema, { max: 50 }),
  notices: arr(noticeSchema, { max: 100 }),
  offers: view({ incoming: arr(offerViewSchema, { max: 50 }), outgoing: arr(offerViewSchema, { max: 50 }) }),
  gifts: arr(giftViewSchema, { max: 20 }),
  listings: optional(arr(listingViewSchema, { max: 100 })),
  now: time,
})

export const versionResponseSchema = view<VersionResponse>({
  api: int(1, 1000),
  server: str({ max: 48, re: SEMVER_RE }),
  rules: int(1, 1_000_000),
  generator: int(1, 1_000_000),
  minClient: str({ max: 48, re: SEMVER_RE }),
  latestClient: str({ max: 48, re: SEMVER_RE }),
  sunset: optional(view({ api: int(1, 1000), date: day })),
  features: arr(str({ max: 40, re: /^[a-z0-9-]+$/ }), { max: 100 }),
})
export const seasonResponseSchema = view<SeasonResponse>({ season: int(1, 9999), generator: int(1, 1_000_000), species: arr(speciesSchema, { min: 36, max: 36 }) },
  v => v.species.every(s => s.season === v.season) ? null : 'species from another season')
export const worldResponseSchema = view<WorldResponse>({ day, season: int(1, 9999), rule: ruleView, featured: speciesId, roamer: speciesId, players: count })
export const challengeResponseSchema = view<ChallengeResponse>({ challenge: str({ min: 8, max: 128, re: TOKEN_RE }), difficulty: int(1, 32) })
export const joinResponseSchema = view<JoinResponse>({ token, me: meResponseSchema })
export const tokenResponseSchema = view<TokenResponse>({ token })
export const devicesResponseSchema = view<DevicesResponse>({ sessions: int(0, 1000), passkeys: int(0, 1000) })
export const authStartResponseSchema = view<AuthStartResponse>({ url: str({ max: 512, re: URL_RE }), pollId: id })
export const authPollResponseSchema = union<AuthPollResponse>('status', {
  pending: view({ status: oneOf(['pending'] as const) }),
  added: view({ status: oneOf(['added'] as const) }),
  done: view({ status: oneOf(['done'] as const), token, me: meResponseSchema }),
}, () => ({ status: 'pending' }))
export const handleResponseSchema = view<HandleResponse>({ handle, handleRerollFrom: day })
export const leaderboardOptResponseSchema = view<LeaderboardOptResponse>({ leaderboard: bool })
export const deleteResponseSchema = view<DeleteResponse>({ deleted: oneOf([true] as const) })
export const cardsResponseSchema = view<CardsResponse>({ cards: arr(cardSchema, { max: 10_000 }), version: count, next: optional(str({ max: 64, re: CURSOR_RE })) })
export const packsResponseSchema = view<PacksResponse>({ packs: arr(packViewSchema, { max: 50 }) })
export const openPackResponseSchema = view<OpenPackResponse>({ cards: arr(cardSchema, { min: 1, max: 5 }) })
export const teamResponseSchema = view<TeamResponse>({ team: arr(id, { max: 3 }) })
export const startBattleResponseSchema = view<StartBattleResponse>({
  id,
  setup: battleSetupSchema,
  opponent: union('kind', {
    wild: view({ kind: oneOf(['wild'] as const) }),
    player: view({ kind: oneOf(['player'] as const), handle, league: leagueView }),
    rival: view({ kind: oneOf(['rival'] as const), name: str({ max: 24, re: /^[A-Z][a-z]{2,23}$/ }), league: leagueView }),
  }, () => ({ kind: 'wild' as const })),
  subs: arr(view({ slot, cardId: id, replaced: nullable(id) }), { max: 3 }),
  firstPossible: arr(bool, { max: 3 }),
  startedAt: time,
  finishAfter: time,
})
export const finishBattleResponseSchema = view<FinishBattleResponse>({
  result: oneOf(['win', 'loss', 'draw'] as const),
  sparks: count,
  xp: arr(view({ cardId: id, xp: int(0, 1000), levelsGained: int(0, 9), evolved: bool, stage: oneOf([1, 2, 3] as const) }), { max: 3 }),
  rating,
  ratingDelta: int(-100, 100),
  catchOptions: arr(battleCardSchema, { max: 3 }),
  bounty: nullable(cardSchema),
  dailyWinPack: bool,
  streak: count,
  streakPack: bool,
  tired: arr(id, { max: 3 }),
  log: battleLogSchema,
})
export const cardResponseSchema = view<CardResponse>({ card: cardSchema })
export const fuseResponseSchema = view<FuseResponse>({ card: cardSchema, consumed: tuple<[string, string]>(id, id) })
export const recycleResponseSchema = view<RecycleResponse>({ sparks: count, gained: count })
export const wishlistResponseSchema = view<WishlistResponse>({ wishlist: arr(speciesId, { max: 5 }) })
export const profileResponseSchema = view<ProfileResponse>({
  handle,
  league: leagueView,
  team: arr(battleCardSchema, { max: 3 }),
  forTrade: arr(battleCardSchema, { max: 200 }),
  seenCount: count,
  stats: optional(playerStatsSchema),
})
export const boardResponseSchema = view<BoardResponse>({
  matches: arr(view({ handle, theirs: battleCardSchema, mine: battleCardSchema }), { max: 20 }),
  recent: arr(view({ handle, card: battleCardSchema }), { max: 50 }),
  trader: arr(traderDealViewSchema, { max: 10 }),
})
export const offerResponseSchema = view<OfferResponse>({ offer: offerViewSchema })
export const giftResponseSchema = view<GiftResponse>({ gift: giftViewSchema })
export const leaderboardResponseSchema = view<LeaderboardResponse>({ top: arr(view({ handle, league: leagueView, rating }), { max: 100 }) })
const rankRowSchema = view<RankRow>({ rank: int(1, 1e9), handle, league: leagueView, value: count })
export const rankingsResponseSchema = view<RankingsResponse>({
  board: oneOf(['rating', 'beaten', 'duelWins', 'species', 'mythics', 'sales'] as const, 'rating'),
  period: oneOf(['all', 'season'] as const, 'all'),
  season: int(1, 9999),
  top: arr(rankRowSchema, { max: 100 }),
  me: optional(rankRowSchema),
})
export const marketResponseSchema = view<MarketResponse>({
  listings: arr(listingViewSchema, { max: 100 }),
  next: optional(str({ max: 64, re: CURSOR_RE })),
  prices: arr(view({ species: speciesId, sales: arr(saleViewSchema, { max: 20 }) }), { max: 100 }),
})
export const listingResponseSchema = view<ListingResponse>({ listing: listingViewSchema })
export const buyResponseSchema = view<BuyResponse>({ listing: listingViewSchema, card: cardSchema, sparks: count })
export const redeemResponseSchema = view<RedeemResponse>({ cards: arr(cardSchema, { max: 20 }), packs: arr(packViewSchema, { max: 20 }) })
export const traderResponseSchema = view<TraderResponse>({ day, deals: arr(traderDealViewSchema, { max: 10 }) })
export const traderDealResponseSchema = view<TraderDealResponse>({ cards: arr(cardSchema, { max: 5 }), packs: arr(packViewSchema, { max: 5 }), consumed: arr(id, { max: 10 }) })

// ---------- requests (parsed strictly; none accepts card data) ----------

const ids = (min: number, max: number) => arr(id, { min, max, unique: true })

export const emptyRequestSchema = obj<EmptyRequest>({})
export const handleRequestSchema = obj<HandleRequest>({ handle: optional(handle) })
export const joinRequestSchema = obj<JoinRequest>({
  challenge: str({ min: 8, max: 128, re: TOKEN_RE }),
  nonce: str({ min: 1, max: 32, re: /^[0-9a-z]+$/ }),
  family,
})
export const leaderboardOptRequestSchema = obj<LeaderboardOptRequest>({ optIn: bool })
export const chargeRequestSchema = obj<ChargeRequest>({ family })
export const buyPackRequestSchema = obj<BuyPackRequest>({ family })
export const openPackRequestSchema = obj<OpenPackRequest>({ packId: id })
export const teamRequestSchema = obj<TeamRequest>({ cardIds: ids(0, 3) })
export const startBattleRequestSchema = obj<StartBattleRequest>(
  { kind: oneOf(['wild', 'duel'] as const), family, revenge: optional(handle), handle: optional(handle) },
  v => v.handle !== undefined && (v.kind !== 'duel' || v.revenge !== undefined) ? 'a challenge is a duel, and never a revenge too' : null,
)
export const finishBattleRequestSchema = obj<FinishBattleRequest>({ inputs: arr(int(1, 30), { max: 30 }) }, v =>
  v.inputs.every((r, i) => i === 0 || r > v.inputs[i - 1]!) ? null : 'inputs must be strictly increasing')
export const catchRequestSchema = obj<CatchRequest>({ index: int(0, 2) })
export const fuseRequestSchema = obj<FuseRequest>({ otherId: id })
export const forTradeRequestSchema = obj<ForTradeRequest>({ forTrade: bool })
export const craftRequestSchema = obj<CraftRequest>({ speciesId, rarity })
export const wishlistRequestSchema = obj<WishlistRequest>({ species: arr(speciesId, { max: 5, unique: true }) })
export const offerRequestSchema = obj<OfferRequest>({ to: handle, give: ids(1, 3), get: ids(0, 3) })
export const counterRequestSchema = obj<CounterRequest>({ give: ids(1, 3), get: ids(0, 3) })
export const giftRequestSchema = obj<GiftRequest>({ cardId: id })
export const claimRequestSchema = obj<ClaimRequest>({ code: giftCode })
export const redeemRequestSchema = obj<RedeemRequest>({ code: str({ min: 3, max: 40, re: DROP_CODE_RE }) })
export const traderDealRequestSchema = obj<TraderDealRequest>({ cardIds: ids(1, 10) })
export const marketWantRequestSchema = obj<MarketWant>(wantShape, wantProblem)
export const listCardRequestSchema = obj<ListCardRequest>({ cardId: id, price: optional(price), want: optional(marketWantRequestSchema) }, v =>
  v.price === undefined && v.want === undefined ? 'a listing asks for sparks, a card or both' : null)
export const buyRequestSchema = obj<BuyRequest>({ cardId: optional(id) })

/** Path parameters, by name, as API_ROUTES spells them. */
export const PATH_PARAMS: Readonly<Record<string, RegExp>> = {
  season: /^[1-9]\d{0,3}$/, pollId: ID_RE, battleId: ID_RE, cardId: ID_RE, offerId: ID_RE, dealId: TRADER_DEAL_RE,
  handle: HANDLE_RE, code: GIFT_CODE_RE, listingId: ID_RE,
  // query parameters (ApiRoute.query) are checked the same way
  after: CURSOR_RE,
  board: /^(?:rating|beaten|duelWins|species|mythics|sales)$/,
  period: /^(?:all|season)$/,
  family: /^(?:haiku|sonnet|opus|fable)$/,
  rarity: /^(?:common|rare|epic|legendary)$/,
  species: CARD_SPECIES_RE,
  shiny: /^(?:true|false)$/,
  foil: /^(?:true|false)$/,
  kind: /^(?:sparks|swap|both)$/,
  minPrice: /^(?:0|[1-9]\d{0,6})$/,
  maxPrice: /^(?:0|[1-9]\d{0,6})$/,
  sort: /^(?:newest|cheapest|priciest)$/,
}

/** Query fields that are numbers or booleans on the request object (strings otherwise). */
const QUERY_NUMBERS = new Set(['minPrice', 'maxPrice'])
const QUERY_BOOLEANS = new Set(['shiny', 'foil'])

/**
 * An operation's query fields from a URL's search parameters, checked like path parameters and typed as the request
 * object has them. Strict: a field the route does not take, or one given twice, throws.
 */
export function parseQuery(names: readonly string[], params: URLSearchParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [name, value] of params) {
    if (!names.includes(name)) fail(`$.${name}`, 'unknown query field')
    if (Object.hasOwn(out, name)) fail(`$.${name}`, 'given twice')
    const v = parsePathParam(name, value)
    out[name] = QUERY_NUMBERS.has(name) ? Number(v) : QUERY_BOOLEANS.has(name) ? v === 'true' : v
  }
  return out
}

/** The JSON body schema of every operation; null where the operation sends no body (GET and DELETE). */
export const REQUEST_SCHEMAS: Readonly<Record<ApiOp, Schema<unknown> | null>> = {
  version: null, season: null, world: null, challenge: null, join: joinRequestSchema, authStart: emptyRequestSchema,
  authPoll: null, me: null, deleteMe: null, resetToken: emptyRequestSchema, devices: null, passkeyStart: emptyRequestSchema,
  rerollHandle: handleRequestSchema, setLeaderboard: leaderboardOptRequestSchema, cards: null, chargePack: chargeRequestSchema,
  buyPack: buyPackRequestSchema, openPack: openPackRequestSchema, setTeam: teamRequestSchema, startBattle: startBattleRequestSchema,
  finishBattle: finishBattleRequestSchema, catchCreature: catchRequestSchema, fuse: fuseRequestSchema, recycle: emptyRequestSchema,
  setForTrade: forTradeRequestSchema, craft: craftRequestSchema, setWishlist: wishlistRequestSchema, profile: null,
  leaderboard: null, board: null, offer: offerRequestSchema, acceptOffer: emptyRequestSchema, declineOffer: emptyRequestSchema,
  cancelOffer: emptyRequestSchema, counterOffer: counterRequestSchema, gift: giftRequestSchema, cancelGift: emptyRequestSchema,
  claim: claimRequestSchema, redeem: redeemRequestSchema, trader: null, traderDeal: traderDealRequestSchema,
  rankings: null, market: null, listCard: listCardRequestSchema, buyListing: buyRequestSchema, cancelListing: emptyRequestSchema,
}

/** The response schema of every operation. */
export const RESPONSE_SCHEMAS: Readonly<Record<ApiOp, Schema<unknown>>> = {
  version: versionResponseSchema, season: seasonResponseSchema, world: worldResponseSchema, challenge: challengeResponseSchema,
  join: joinResponseSchema, authStart: authStartResponseSchema, authPoll: authPollResponseSchema, me: meResponseSchema,
  deleteMe: deleteResponseSchema, resetToken: tokenResponseSchema, devices: devicesResponseSchema,
  passkeyStart: authStartResponseSchema, rerollHandle: handleResponseSchema, setLeaderboard: leaderboardOptResponseSchema,
  cards: cardsResponseSchema, chargePack: packsResponseSchema, buyPack: packsResponseSchema, openPack: openPackResponseSchema,
  setTeam: teamResponseSchema, startBattle: startBattleResponseSchema, finishBattle: finishBattleResponseSchema,
  catchCreature: cardResponseSchema, fuse: fuseResponseSchema, recycle: recycleResponseSchema, setForTrade: cardResponseSchema,
  craft: cardResponseSchema, setWishlist: wishlistResponseSchema, profile: profileResponseSchema,
  leaderboard: leaderboardResponseSchema, board: boardResponseSchema, offer: offerResponseSchema, acceptOffer: offerResponseSchema,
  declineOffer: offerResponseSchema, cancelOffer: offerResponseSchema, counterOffer: offerResponseSchema, gift: giftResponseSchema,
  cancelGift: giftResponseSchema, claim: cardResponseSchema, redeem: redeemResponseSchema, trader: traderResponseSchema,
  traderDeal: traderDealResponseSchema, rankings: rankingsResponseSchema, market: marketResponseSchema,
  listCard: listingResponseSchema, buyListing: buyResponseSchema, cancelListing: listingResponseSchema,
}

// ---------- admin data (strict) ----------

export const promoEggSchema = obj<PromoEgg>({
  seed: str({ min: 1, max: 64, re: ID_RE }),
  name,
  family,
  rarity,
  foil: bool,
  stamp: text(40),
}, p => isBlocked(p.name) ? 'name is blocked' : null)

const dropItemSchema = union<DropRewardItem>('type', {
  egg: obj({ type: oneOf(['egg'] as const), promo: promoEggSchema }),
  pack: obj({ type: oneOf(['pack'] as const), family: optional(family), count: int(1, 3) }),
  card: obj({ type: oneOf(['card'] as const), rarity, family: optional(family) }),
})

/** `drops.reward_json`: one item or a list of up to 8 (SPEC section 25). */
export const dropRewardSchema: Schema<DropReward> = (v, path) =>
  Array.isArray(v) ? arr(dropItemSchema, { min: 1, max: 8 })(v, path) : dropItemSchema(v, path)

// ---------- parse functions ----------
// The shapes the mod and the server read outside the route table; anything else is parse(schema, value).

const parser = <T>(s: Schema<T>) => (v: unknown): T => s(v, '$')

export const parseCardForm = parser(cardFormSchema)
export const parseCard = parser(cardSchema)
export const parseBattleCard = parser(battleCardSchema)
export const parseBattleSetup = parser(battleSetupSchema)
export const parseApiError = parser(apiErrorSchema)
export const parseNotice = parser(noticeSchema)
export const parseMeResponse = parser(meResponseSchema)
export const parseVersionResponse = parser(versionResponseSchema)
export const parseSeasonResponse = parser(seasonResponseSchema)
export const parseCardsResponse = parser(cardsResponseSchema)
export const parseDropReward = parser(dropRewardSchema)

/** Parses an operation's request body (strict). Ops without a body accept only an absent body or `{}`. */
export function parseRequest<K extends ApiOp>(op: K, body: unknown): unknown {
  const s = REQUEST_SCHEMAS[op]
  return s ? s(body, '$') : emptyRequestSchema(body ?? {}, '$')
}

/** Reads an operation's response (tolerant). */
export function parseResponse<K extends ApiOp>(op: K, body: unknown): unknown {
  return RESPONSE_SCHEMAS[op](body, '$')
}

/** Checks a path parameter against its format. */
export function parsePathParam(name: string, value: string): string {
  const re = PATH_PARAMS[name]
  if (!re || value.length > 64 || !re.test(value)) fail(`$.${name}`, 'bad path parameter')
  return value
}

// ---------- display text ----------

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-_])/g
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g

/** Makes untrusted text safe to draw: escape sequences, control and bidi characters gone, cut to `max` code points. */
export function cleanText(s: unknown, max = 80): string {
  if (typeof s !== 'string') return ''
  const chars = Array.from(s.replace(ANSI, '').replace(UNSAFE, ''))
  return chars.length > max ? chars.slice(0, Math.max(0, max - 1)).join('') + '…' : chars.join('')
}

// ---------- what client/net.ts readAnswer also required of every answer in 0.2.2 ----------

export const RESPONSE_MAX_BYTES = 262144
export const JSON_CONTENT_TYPE = /^application\/json(\s*;|$)/i
export const RETRY_AFTER = /^\s*\d{1,6}\s*$/

// The wire contract between the mod and the server: every operation's request and response, the route table, and
// SpinlingsApi, the one interface both of the mod's backends implement (RemoteBackend over HTTP, LocalBackend
// offline; SPEC section 28). Runtime validators for these shapes live in core/schemas.ts and are used by BOTH
// sides: the server parses requests strictly, the client reads responses tolerantly (SPEC section 32).
import type {
  BattleCard, BattleLog, BattleResult, BattleSetup, Card, DailyRule, Family, LeagueName, Rarity, Species, TraderDeal,
} from './types.ts'

/** The wire API version: `/v1`. */
export const API_VERSION = 1

/** Feature flags a server may list in GET /v1/version; the mod hides what a server does not list. */
export const FEATURES = ['rivals', 'trader', 'redeem', 'passkey', 'leaderboard', 'handle-reroll', 'mythics', 'seasons'] as const
export type Feature = (typeof FEATURES)[number]

export type ApiErrorCode =
  | 'bad_request' | 'unauthorized' | 'not_found' | 'rate_limited' | 'cap_reached' | 'not_allowed' | 'conflict'
  | 'insufficient_sparks' | 'expired' | 'too_large' | 'unavailable' | 'upgrade_required'

export type ApiError = { error: { code: ApiErrorCode; message: string } }

/** The player's own view. Other players never see any of it except as their public profile (ProfileResponse). */
export type PlayerView = {
  handle: string
  /** the UTC day from which the handle may be rerolled again (once a week) */
  handleRerollFrom: string
  sparks: number
  rating: number
  league: LeagueName
  /** listed on the public leaderboard (opt-in, off by default) */
  leaderboard: boolean
  /** UTC day of joining (day granularity, SPEC section 20) */
  joinedDay: string
  /** finished battles in all; the trust gate counts them */
  battles: number
  /** passes the trust gate for trading and sending gifts (3 days old, 10 battles) */
  canTrade: boolean
  team: string[]
  wishlist: string[]
  /** bumps whenever any of this player's cards change; refetch /v1/cards when it moves */
  cardsVersion: number
  /** consecutive wins; every 3rd pays a streak pack (SPEC section 14) */
  streak: number
  /** species ids this player has ever owned (album) */
  seen: string[]
  /** the next wild lead is rare or better (the rested bonus, SPEC section 17) */
  rested: boolean
  /** the earliest server times a wild battle, a duel and a pack charge are accepted (server pacing, SPEC section 24) */
  nextWildAt: number
  nextDuelAt: number
  nextChargeAt: number
}

export type PackSource = 'welcome' | 'charge' | 'bought' | 'daily' | 'bonus' | 'streak' | 'season' | 'trader' | 'promo'
export type PackView = { id: string; family: Family; source: PackSource; /** UTC day */ day: string }

export type NoticeKind =
  | 'defense-win' | 'defense-loss' | 'evolved' | 'gift-claimed' | 'gift-returned' | 'offer-received' | 'offer-accepted'
  | 'offer-declined' | 'offer-expired' | 'bonus-pack' | 'daily-pack' | 'streak-pack' | 'season-end' | 'new-device'
  /** the tolerant reader's fallback for a kind this client does not know: show the text only */
  | 'notice'

export type Notice = {
  id: string
  /** UTC day only: shown as "today", "yesterday" or the date, never a time (SPEC section 20) */
  day: string
  kind: NoticeKind
  /** server-composed from fixed templates; the client still sanitizes it */
  text: string
  /** the other player, for defense notices (revenge) and offers */
  handle?: string
}

export type OfferState = 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired'

export type OfferView = {
  id: string
  from: string
  to: string
  give: BattleCard[]
  get: BattleCard[]
  state: OfferState
  createdAt: number
  expiresAt: number
}

export type GiftView = { code: string; card: Card; createdAt: number; expiresAt: number; claimedBy?: string }

export type MeResponse = {
  player: PlayerView
  packs: PackView[]
  notices: Notice[]
  offers: { incoming: OfferView[]; outgoing: OfferView[] }
  gifts: GiftView[]
  now: number
}

// ---------- requests and responses ----------

export type EmptyRequest = Record<string, never>
export type VersionResponse = {
  api: number
  server: string
  rules: number
  generator: number
  minClient: string
  latestClient: string
  sunset?: { api: number; date: string }
  features: string[]
}
export type SeasonResponse = { season: number; generator: number; species: Species[] }
export type WorldResponse = { day: string; season: number; rule: DailyRule; featured: string; roamer: string; players: number }
export type ChallengeResponse = { challenge: string; difficulty: number }
export type JoinRequest = { challenge: string; nonce: string; family: Family }
/** `token` is the new session's bearer: returned exactly once, kept only in $.store */
export type JoinResponse = { token: string; me: MeResponse }
export type TokenResponse = { token: string }
export type DevicesResponse = { sessions: number; passkeys: number }
/** `url` is a page on the same server origin (isOnServer); `pollId` is polled at GET /v1/auth/poll/:pollId */
export type AuthStartResponse = { url: string; pollId: string }
export type AuthPollResponse =
  | { status: 'pending' }
  /** a passkey was saved to this account */
  | { status: 'added' }
  /** a passkey sign-in finished: the new session, delivered exactly once */
  | { status: 'done'; token: string; me: MeResponse }
export type HandleResponse = { handle: string; handleRerollFrom: string }
export type LeaderboardOptRequest = { optIn: boolean }
export type LeaderboardOptResponse = { leaderboard: boolean }
export type DeleteResponse = { deleted: true }
export type CardsResponse = { cards: Card[]; version: number }
export type ChargeRequest = { family: Family }
export type BuyPackRequest = { family: Family }
export type PacksResponse = { packs: PackView[] }
export type OpenPackRequest = { packId: string }
export type OpenPackResponse = { cards: Card[] }
export type TeamRequest = { cardIds: string[] }
export type TeamResponse = { team: string[] }
export type StartBattleRequest = { kind: 'wild' | 'duel'; family: Family; /** duel this player (a revenge from a defense notice) */ revenge?: string }
export type Opponent =
  | { kind: 'wild' }
  | { kind: 'player'; handle: string; league: LeagueName }
  /** a generated Rival trainer, shown as "Rival {name}" */
  | { kind: 'rival'; name: string; league: LeagueName }
export type StartBattleResponse = {
  id: string
  setup: BattleSetup
  opponent: Opponent
  /** auto-filled slots: a tired or missing team card replaced by another card */
  subs: { slot: number; cardId: string; replaced: string | null }[]
  /** per defender slot: nobody has obtained this species yet this season (the FIRST IN THE WORLD tease) */
  firstPossible: boolean[]
  startedAt: number
  /** finish is refused before this server time (rounds x 1.5 s with no inputs) */
  finishAfter: number
}
export type FinishBattleRequest = { inputs: number[] }
export type FinishBattleResponse = {
  result: BattleResult
  sparks: number
  xp: { cardId: string; xp: number; levelsGained: number; evolved: boolean; stage: 1 | 2 | 3 }[]
  rating: number
  ratingDelta: number
  /** a wild win that rolled a catch: pick one within 10 minutes; empty on a slip */
  catchOptions: BattleCard[]
  bounty: Card | null
  dailyWinPack: boolean
  streak: number
  streakPack: boolean
  tired: string[]
  /** the authoritative log: animate it whenever setup.rules differs from this client's RULES_VERSION */
  log: BattleLog
}
export type CatchRequest = { index: number }
export type CardResponse = { card: Card }
export type FuseRequest = { otherId: string }
export type FuseResponse = { card: Card; consumed: [string, string] }
export type RecycleResponse = { sparks: number; gained: number }
export type ForTradeRequest = { forTrade: boolean }
export type CraftRequest = { speciesId: string; rarity: Rarity }
export type WishlistRequest = { species: string[] }
export type WishlistResponse = { wishlist: string[] }
/** Exactly what another player may see (SPEC section 20): no rating, counts, dates or activity. */
export type ProfileResponse = { handle: string; league: LeagueName; team: BattleCard[]; forTrade: BattleCard[]; seenCount: number }
export type TraderDealView = TraderDeal & { used: boolean }
export type BoardResponse = {
  matches: { handle: string; theirs: BattleCard; mine: BattleCard }[]
  recent: { handle: string; card: BattleCard }[]
  trader: TraderDealView[]
}
export type OfferRequest = { to: string; give: string[]; get: string[] }
export type OfferResponse = { offer: OfferView }
export type CounterRequest = { give: string[]; get: string[] }
export type GiftRequest = { cardId: string }
export type GiftResponse = { gift: GiftView }
export type ClaimRequest = { code: string }
/** Opt-in players only: handle, league and rating. */
export type LeaderboardResponse = { top: { handle: string; league: LeagueName; rating: number }[] }
export type RedeemRequest = { code: string }
export type RedeemResponse = { cards: Card[]; packs: PackView[] }
export type TraderResponse = { day: string; deals: TraderDealView[] }
export type TraderDealRequest = { cardIds: string[] }
export type TraderDealResponse = { cards: Card[]; packs: PackView[]; consumed: string[] }

// ---------- the one interface ----------

/**
 * Every operation, as one method taking one request object: the path parameters (named as in API_ROUTES) plus the
 * JSON body fields. RemoteBackend maps each call with routeOf; LocalBackend implements the offline subset
 * (API_ROUTES[op].offline) and answers the rest with `not_allowed`.
 */
export interface SpinlingsApi {
  /** GET /v1/version (public) */
  version(req: EmptyRequest): Promise<VersionResponse>
  /** GET /v1/season/:season (public, immutable) */
  season(req: { season: number }): Promise<SeasonResponse>
  /** GET /v1/world (public) */
  world(req: EmptyRequest): Promise<WorldResponse>
  /** GET /v1/challenge (public) */
  challenge(req: EmptyRequest): Promise<ChallengeResponse>
  /** POST /v1/join (public, proof of work) */
  join(req: JoinRequest): Promise<JoinResponse>
  /** POST /v1/auth/start (public): sign in on this machine with a saved passkey */
  authStart(req: EmptyRequest): Promise<AuthStartResponse>
  /** GET /v1/auth/poll/:pollId (public) */
  authPoll(req: { pollId: string }): Promise<AuthPollResponse>
  /** GET /v1/me */
  me(req: EmptyRequest): Promise<MeResponse>
  /** DELETE /v1/me */
  deleteMe(req: EmptyRequest): Promise<DeleteResponse>
  /** POST /v1/me/token: revokes every session and returns one new token ("Reset access") */
  resetToken(req: EmptyRequest): Promise<TokenResponse>
  /** GET /v1/me/devices */
  devices(req: EmptyRequest): Promise<DevicesResponse>
  /** POST /v1/me/passkey/start */
  passkeyStart(req: EmptyRequest): Promise<AuthStartResponse>
  /** POST /v1/me/handle: a fresh random handle, once a week */
  rerollHandle(req: EmptyRequest): Promise<HandleResponse>
  /** PUT /v1/me/leaderboard */
  setLeaderboard(req: LeaderboardOptRequest): Promise<LeaderboardOptResponse>
  /** GET /v1/cards */
  cards(req: EmptyRequest): Promise<CardsResponse>
  /** POST /v1/packs/charge */
  chargePack(req: ChargeRequest): Promise<PacksResponse>
  /** POST /v1/packs/buy */
  buyPack(req: BuyPackRequest): Promise<PacksResponse>
  /** POST /v1/packs/open */
  openPack(req: OpenPackRequest): Promise<OpenPackResponse>
  /** PUT /v1/team */
  setTeam(req: TeamRequest): Promise<TeamResponse>
  /** POST /v1/battles */
  startBattle(req: StartBattleRequest): Promise<StartBattleResponse>
  /** POST /v1/battles/:battleId/finish */
  finishBattle(req: { battleId: string } & FinishBattleRequest): Promise<FinishBattleResponse>
  /** POST /v1/battles/:battleId/catch */
  catchCreature(req: { battleId: string } & CatchRequest): Promise<CardResponse>
  /** POST /v1/cards/:cardId/fuse */
  fuse(req: { cardId: string } & FuseRequest): Promise<FuseResponse>
  /** POST /v1/cards/:cardId/recycle */
  recycle(req: { cardId: string }): Promise<RecycleResponse>
  /** POST /v1/cards/:cardId/for-trade */
  setForTrade(req: { cardId: string } & ForTradeRequest): Promise<CardResponse>
  /** POST /v1/craft */
  craft(req: CraftRequest): Promise<CardResponse>
  /** PUT /v1/wishlist */
  setWishlist(req: WishlistRequest): Promise<WishlistResponse>
  /** GET /v1/players/:handle */
  profile(req: { handle: string }): Promise<ProfileResponse>
  /** GET /v1/leaderboard */
  leaderboard(req: EmptyRequest): Promise<LeaderboardResponse>
  /** GET /v1/board */
  board(req: EmptyRequest): Promise<BoardResponse>
  /** POST /v1/offers */
  offer(req: OfferRequest): Promise<OfferResponse>
  /** POST /v1/offers/:offerId/accept */
  acceptOffer(req: { offerId: string }): Promise<OfferResponse>
  /** POST /v1/offers/:offerId/decline */
  declineOffer(req: { offerId: string }): Promise<OfferResponse>
  /** POST /v1/offers/:offerId/cancel */
  cancelOffer(req: { offerId: string }): Promise<OfferResponse>
  /** POST /v1/offers/:offerId/counter: declines and returns the new offer */
  counterOffer(req: { offerId: string } & CounterRequest): Promise<OfferResponse>
  /** POST /v1/gifts */
  gift(req: GiftRequest): Promise<GiftResponse>
  /** POST /v1/gifts/:code/cancel */
  cancelGift(req: { code: string }): Promise<GiftResponse>
  /** POST /v1/claim */
  claim(req: ClaimRequest): Promise<CardResponse>
  /** POST /v1/redeem */
  redeem(req: RedeemRequest): Promise<RedeemResponse>
  /** GET /v1/trader */
  trader(req: EmptyRequest): Promise<TraderResponse>
  /** POST /v1/trader/:dealId */
  traderDeal(req: { dealId: string } & TraderDealRequest): Promise<TraderDealResponse>
}

export type ApiOp = keyof SpinlingsApi
export type ApiRequest<K extends ApiOp> = Parameters<SpinlingsApi[K]>[0]
export type ApiResponse<K extends ApiOp> = Awaited<ReturnType<SpinlingsApi[K]>>

export type ApiRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** `:name` segments are filled from the request object's fields of that name */
  path: string
  /** needs `Authorization: Bearer` */
  auth: boolean
  /** implemented by the offline LocalBackend */
  offline: boolean
}

const r = (method: ApiRoute['method'], path: string, auth: boolean, offline: boolean): ApiRoute => ({ method, path, auth, offline })

export const API_ROUTES: Readonly<Record<ApiOp, ApiRoute>> = {
  version: r('GET', '/v1/version', false, false),
  season: r('GET', '/v1/season/:season', false, true),
  world: r('GET', '/v1/world', false, true),
  challenge: r('GET', '/v1/challenge', false, false),
  join: r('POST', '/v1/join', false, false),
  authStart: r('POST', '/v1/auth/start', false, false),
  authPoll: r('GET', '/v1/auth/poll/:pollId', false, false),
  me: r('GET', '/v1/me', true, true),
  deleteMe: r('DELETE', '/v1/me', true, true),
  resetToken: r('POST', '/v1/me/token', true, false),
  devices: r('GET', '/v1/me/devices', true, false),
  passkeyStart: r('POST', '/v1/me/passkey/start', true, false),
  rerollHandle: r('POST', '/v1/me/handle', true, false),
  setLeaderboard: r('PUT', '/v1/me/leaderboard', true, false),
  cards: r('GET', '/v1/cards', true, true),
  chargePack: r('POST', '/v1/packs/charge', true, true),
  buyPack: r('POST', '/v1/packs/buy', true, true),
  openPack: r('POST', '/v1/packs/open', true, true),
  setTeam: r('PUT', '/v1/team', true, true),
  startBattle: r('POST', '/v1/battles', true, true),
  finishBattle: r('POST', '/v1/battles/:battleId/finish', true, true),
  catchCreature: r('POST', '/v1/battles/:battleId/catch', true, true),
  fuse: r('POST', '/v1/cards/:cardId/fuse', true, true),
  recycle: r('POST', '/v1/cards/:cardId/recycle', true, true),
  setForTrade: r('POST', '/v1/cards/:cardId/for-trade', true, false),
  craft: r('POST', '/v1/craft', true, true),
  setWishlist: r('PUT', '/v1/wishlist', true, false),
  profile: r('GET', '/v1/players/:handle', true, false),
  leaderboard: r('GET', '/v1/leaderboard', true, false),
  board: r('GET', '/v1/board', true, false),
  offer: r('POST', '/v1/offers', true, false),
  acceptOffer: r('POST', '/v1/offers/:offerId/accept', true, false),
  declineOffer: r('POST', '/v1/offers/:offerId/decline', true, false),
  cancelOffer: r('POST', '/v1/offers/:offerId/cancel', true, false),
  counterOffer: r('POST', '/v1/offers/:offerId/counter', true, false),
  gift: r('POST', '/v1/gifts', true, false),
  cancelGift: r('POST', '/v1/gifts/:code/cancel', true, false),
  claim: r('POST', '/v1/claim', true, false),
  redeem: r('POST', '/v1/redeem', true, false),
  trader: r('GET', '/v1/trader', true, true),
  traderDeal: r('POST', '/v1/trader/:dealId', true, true),
}

/**
 * Splits a request object into the filled path and the JSON body (every field that is not a path parameter).
 * GET and DELETE carry no body. Path values are URI-encoded.
 */
export function routeOf<K extends ApiOp>(op: K, req: ApiRequest<K>): { method: ApiRoute['method']; path: string; body: Record<string, unknown> | null } {
  const route = API_ROUTES[op]
  const rest: Record<string, unknown> = { ...(req as Record<string, unknown>) }
  const path = route.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = rest[name]
    delete rest[name]
    if (typeof v !== 'string' && typeof v !== 'number') throw new TypeError(`${op}: missing path parameter ${name}`)
    return encodeURIComponent(String(v))
  })
  return { method: route.method, path, body: route.method === 'GET' || route.method === 'DELETE' ? null : rest }
}

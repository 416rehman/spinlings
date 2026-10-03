// The $.state contract of the Spinlings mod: every value the band, the pane and the status line read.
// A contract is self-contained (types only, no imports), so the wire and domain shapes are restated from
// hooks/core/types.ts and hooks/core/api.ts under a `Spin` prefix; tests/arch.test.ts holds each restatement
// equal to its original, so the copies cannot drift. client/types.ts re-exports these under plain names.
// Every value written here came through core/schemas.ts (online) or the offline save's own checks.

// ---------- domain (restated from core/types.ts) ----------

export type SpinFamily = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type SpinRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type SpinBody = 'blob' | 'critter' | 'bird' | 'ghost' | 'bug' | 'wyrm'
export type SpinPattern = 'none' | 'spots' | 'stripes' | 'belly' | 'mask'
export type SpinAccessory = 'horns' | 'crown' | 'antennae' | 'halo' | 'spikes' | 'wings'
export type SpinSpecialId = 'flurry' | 'couplet' | 'crescendo' | 'twist'
export type SpinTraitId =
  | 'sturdy' | 'swift' | 'thickHide' | 'luckyStar' | 'quickCharge' | 'glassHeart' | 'regrowth' | 'underdog'
  | 'ambush' | 'moonlit' | 'stubborn' | 'showoff' | 'guardian' | 'sleepy' | 'homebody' | 'mimic'
export type SpinDailyRule =
  | 'haikuDay' | 'sonnetDay' | 'opusDay' | 'fableDay' | 'topsyTurvy' | 'glassDay'
  | 'longDay' | 'gentleDay' | 'wildBloom' | 'shinyHour' | 'fusionFair' | 'calm'
export type SpinCardOrigin =
  | 'starter' | 'pack' | 'catch' | 'bounty' | 'craft' | 'fusion' | 'gift' | 'daily' | 'trader' | 'promo' | 'season' | 'unknown'
export type SpinLeague = 'Pebble' | 'Brook' | 'Grove' | 'Peak' | 'Star'
export type SpinStage = 1 | 2 | 3
export type SpinStats = { hp: number; atk: number; def: number; spd: number }
export type SpinGenes = [number, number, number, number]

export type SpinForm = {
  family: SpinFamily
  body: SpinBody
  hue: number
  pattern: SpinPattern
  accessory: SpinAccessory
  base: SpinStats
  names: [string, string, string]
  legendary: boolean
}
export type SpinCardForm = SpinForm & {
  kind: 'fusion' | 'mythic' | 'promo'
  parents?: [string, string]
  seed?: string
  discoveredBy?: string
  stamp?: string
}

export type SpinCard = {
  id: string
  species: string
  form?: SpinCardForm
  season: number
  family: SpinFamily
  rarity: SpinRarity
  shiny: boolean
  foil?: true
  dna: number
  genes: SpinGenes
  traits: SpinTraitId[]
  level: number
  xp: number
  stage: SpinStage
  raisedIn?: SpinFamily
  stats: SpinStats
  bound: boolean
  forTrade: boolean
  origin: SpinCardOrigin
  mintedAt: number
  lockedUntil: number
  tiredUntil: number
  state: 'owned' | 'escrow'
  firstFind?: true
}

/** How a battle sees a card, and how other players' cards are always shown: no ownership details, no timestamps. */
export type SpinBattleCard = Pick<SpinCard,
  'id' | 'species' | 'form' | 'season' | 'family' | 'rarity' | 'shiny' | 'foil' | 'dna' | 'genes' | 'traits'
  | 'level' | 'stage' | 'raisedIn' | 'stats' | 'firstFind'>

export type SpinBattleSetup = {
  seed: string
  kind: 'wild' | 'duel'
  arena: SpinFamily
  rule: SpinDailyRule
  rules: number
  attacker: SpinBattleCard[]
  defender: SpinBattleCard[]
}
export type SpinBattleAction = {
  round: number
  side: 'a' | 'd'
  slot: number
  targetSlot: number
  move: 'attack' | 'special'
  special?: SpinSpecialId
  perfect?: true
  hits: number
  dmg: number
  crit: boolean
  effect: 'super' | 'weak' | 'normal'
  heal: number
  targetFainted: boolean
  traits: SpinTraitId[]
}
export type SpinBattleRound = {
  round: number
  actions: SpinBattleAction[]
  hp: { a: number[]; d: number[] }
  charge: { a: number[]; d: number[] }
  active: { a: number; d: number }
  attackerSpecialReady: boolean
}
export type SpinBattleLog = {
  rounds: SpinBattleRound[]
  result: 'win' | 'loss' | 'draw'
  maxHp: { a: number[]; d: number[] }
  fainted: { a: number[]; d: number[] }
}

// ---------- wire views (restated from core/api.ts) ----------

export type SpinPlayer = {
  handle: string
  handleRerollFrom: string
  sparks: number
  rating: number
  league: SpinLeague
  leaderboard: boolean
  joinedDay: string
  battles: number
  canTrade: boolean
  team: string[]
  wishlist: string[]
  cardsVersion: number
  streak: number
  seen: string[]
  rested: boolean
  nextWildAt: number
  nextDuelAt: number
  nextChargeAt: number
}
export type SpinPackSource = 'welcome' | 'charge' | 'bought' | 'daily' | 'bonus' | 'streak' | 'season' | 'trader' | 'promo'
export type SpinPack = { id: string; family: SpinFamily; source: SpinPackSource; day: string }
export type SpinNoticeKind =
  | 'defense-win' | 'defense-loss' | 'evolved' | 'gift-claimed' | 'gift-returned' | 'offer-received' | 'offer-accepted'
  | 'offer-declined' | 'offer-expired' | 'bonus-pack' | 'daily-pack' | 'streak-pack' | 'season-end' | 'new-device' | 'notice'
export type SpinNotice = { id: string; day: string; kind: SpinNoticeKind; text: string; handle?: string }
export type SpinOffer = {
  id: string
  from: string
  to: string
  give: SpinBattleCard[]
  get: SpinBattleCard[]
  state: 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  createdAt: number
  expiresAt: number
}
export type SpinGift = { code: string; card: SpinCard; createdAt: number; expiresAt: number; claimedBy?: string }
export type SpinMe = {
  player: SpinPlayer
  packs: SpinPack[]
  notices: SpinNotice[]
  offers: { incoming: SpinOffer[]; outgoing: SpinOffer[] }
  gifts: SpinGift[]
  now: number
}
export type SpinOpponent =
  | { kind: 'wild' }
  | { kind: 'player'; handle: string; league: SpinLeague }
  | { kind: 'rival'; name: string; league: SpinLeague }
export type SpinBoard = {
  matches: { handle: string; theirs: SpinBattleCard; mine: SpinBattleCard }[]
  recent: { handle: string; card: SpinBattleCard }[]
  trader: SpinTraderDeal[]
}
export type SpinProfile = { handle: string; league: SpinLeague; team: SpinBattleCard[]; forTrade: SpinBattleCard[]; seenCount: number }
export type SpinTraderDeal = {
  id: string
  name: string
  give: { count: number; family?: SpinFamily; rarity?: SpinRarity }
  get: { kind: 'cards'; count: number; rarity: SpinRarity; family: SpinFamily } | { kind: 'pack'; count: number; family: SpinFamily }
  used: boolean
}
export type SpinLeaderRow = { handle: string; league: SpinLeague; rating: number }

// ---------- game state ----------

export type SpinWorld = 'online' | 'offline'
/**
 * starting: reading the store · joining: the silent first-run join is under way · ready: playing ·
 * unreachable: the server does not answer (the cache shows) · signed-out: the server no longer knows this machine
 */
export type SpinLink = 'starting' | 'joining' | 'ready' | 'unreachable' | 'signed-out'

/** A passkey page the player opens in a browser; drawn as a Link plus its text, only on the server's own origin. */
export type SpinSignIn = { kind: 'add' | 'signin'; url: string; until: number; status: 'pending' | 'added' | 'done' | 'expired' }

/** Which world is active and how the link to it stands. */
export type SpinAccount = {
  world: SpinWorld
  /** the online server's origin (kept while offline, for the switch back) */
  server: string
  /** that origin's host: the pane header and the privacy view always show it */
  host: string
  /** not https://spinlings.dev: someone else's world */
  community: boolean
  link: SpinLink
  /** one plain line about the link when it is not ready, '' otherwise */
  note: string
  /** this mod is older than the server's minClient: online actions are read-only (SPEC 32) */
  readOnly: boolean
  /** what the server says it supports; anything it does not list is hidden */
  features: string[]
  signIn: SpinSignIn | null
  /** signed-in devices and saved passkeys, once asked */
  devices: { sessions: number; passkeys: number } | null
}

export type SpinEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | ''

/** The shape of the session, never its content (SPEC 10). */
export type SpinSignals = {
  /** the family of the model in use: the pack family and the arena */
  family: SpinFamily
  /** battle pace only */
  effort: SpinEffort
  /** Claude's main turn is running */
  working: boolean
  turnStartedAt: number | null
  /** subagents running now, counted only */
  cheering: number
  /** a rate-limit window is full: when it resets (ms), for the comfort line; else null */
  restingUntil: number | null
}

/** A live battle. Rounds on screen are a pure function of setup and inputs (core simulateBattle) or the server's log. */
export type SpinBattle = {
  id: string
  setup: SpinBattleSetup
  opponent: SpinOpponent
  /** auto-filled slots: "Tuftbun stepped in for Pipkin" */
  subs: { slot: number; cardId: string; replaced: string | null }[]
  /** per defender slot: nobody has this species yet this season (the FIRST IN THE WORLD tease) */
  firstPossible: boolean[]
  startedAt: number
  finishAfter: number
  /** setup.rules matches this mod: simulate live with Perfect timing; otherwise animate the server's log */
  live: boolean
  /** rustle, reveal, the rounds, then finishing (waiting on the server) */
  phase: 'rustle' | 'reveal' | 'fight' | 'finishing'
  /** rounds on screen so far; the round being animated is shown + 1 */
  shown: number
  /** 1-based rounds the player pressed [1] on */
  inputs: number[]
  /** the server's log, when not live, once finished */
  log: SpinBattleLog | null
}

export type SpinCatch =
  | { status: 'none' }
  /** a wild win that rolled a catch with more than one creature: [1]-[3], the rarest auto-picked at `deadline` */
  | { status: 'choose'; options: SpinBattleCard[]; deadline: number }
  | { status: 'catching'; options: SpinBattleCard[]; index: number }
  | { status: 'caught'; card: SpinCard }
  /** the catch roll failed: "It slipped away!" */
  | { status: 'slipped' }
  /** a Mythic lost or abandoned: gone forever */
  | { status: 'fled' }

/** A finished battle, as the band's result row, catch ceremony and evolutions show it. */
export type SpinOutcome = {
  battleId: string
  kind: 'wild' | 'duel'
  opponent: SpinOpponent
  /** the defender's lead: "vs wild Fogmaw", the Mythic farewell */
  lead: SpinBattleCard | null
  result: 'win' | 'loss' | 'draw'
  sparks: number
  rating: number
  ratingDelta: number
  league: { from: SpinLeague; to: SpinLeague } | null
  /** Perfect specials landed */
  perfect: number
  xp: { cardId: string; xp: number; levelsGained: number; evolved: boolean; stage: SpinStage }[]
  catch: SpinCatch
  bounty: SpinCard | null
  dailyWinPack: boolean
  streak: number
  streakPack: boolean
}

/**
 * The band's queue: the first entry shows (a live battle shows over all of them). `until` is when it leaves by
 * itself; null stays until acted on or dismissed.
 */
export type SpinMoment =
  /** `note` stands in for the team line: the first run fell back to the offline world (SPEC 34.4) */
  | { kind: 'welcome'; id: string; packId: string | null; until: null; note?: string }
  | { kind: 'outcome'; id: string; outcome: SpinOutcome; until: number | null }
  | { kind: 'evolve'; id: string; cardId: string; from: string; to: string; stage: SpinStage; until: number | null }
  | { kind: 'pack-ready'; id: string; count: number; until: number | null }
  /** a gift claimed or a trade received: a wrapped present */
  | { kind: 'present'; id: string; from: string; cardIds: string[]; until: null }
  /** a newer mod is out: once per version, dismissible */
  | { kind: 'update'; id: string; version: string; until: null }
  | { kind: 'passkey'; id: string; until: null }
  /** an online-only action tried in the offline world */
  | { kind: 'needs-online'; id: string; until: number | null }
  /** /spin server named someone else's server: the one-time consent */
  | { kind: 'server'; id: string; origin: string; until: null }
  | { kind: 'line'; id: string; tone: 'hint' | 'reaction' | 'notice'; text: string; until: number | null }

/** What the pane's ceremony reveals: a pack, a present, an egg, a craft, a deal or a drop. */
export type SpinReveal = {
  id: string
  kind: 'pack' | 'present' | 'egg' | 'craft' | 'trader' | 'redeem' | 'bounty'
  /** the package colour for a pack */
  family: SpinFamily | null
  cards: SpinCard[]
  /** packs a drop or a deal gave alongside */
  packs: SpinPack[]
  /** species ids new to the album with this reveal (NEW badges) */
  fresh: string[]
  album: { before: number; after: number; total: number }
  /** a pack's tear has played: the strip of glowing backs is out */
  torn?: true
}

/** Things fetched on demand for the pane. */
export type SpinSocial = {
  board: SpinBoard | null
  profile: SpinProfile | null
  trader: { day: string; deals: SpinTraderDeal[] } | null
  leaderboard: SpinLeaderRow[] | null
  /** the gift just made: its code and share link */
  gift: { code: string; link: string; cardId: string } | null
  /** what is being fetched now */
  loading: ('board' | 'profile' | 'trader' | 'leaderboard' | 'devices')[]
}

export type SpinTab = 'team' | 'cards' | 'album' | 'trade'
/** Views stacked over the tabs; esc pops one. */
export type SpinView =
  | { kind: 'card'; cardId: string }
  | { kind: 'fuse'; cardId: string; otherId: string | null }
  | { kind: 'species'; speciesId: string }
  | { kind: 'profile'; handle: string; give: string[]; get: string[]; counterOf: string | null }
  | { kind: 'gift'; code: string }
  | { kind: 'reveal' }
  | { kind: 'privacy' }
  | { kind: 'devices' }
  | { kind: 'demo'; step: number }

export type SpinHoldAction =
  | 'recycle' | 'fuse' | 'gift' | 'cancel-offer' | 'cancel-gift' | 'delete-account' | 'reset-access' | 'delete-offline'
/** A 2-second hold on a destructive action: armed on the first press, done by a press once it has run. */
export type SpinHold = { action: SpinHoldAction; target: string; startedAt: number }

export type SpinPane = {
  tab: SpinTab
  stack: SpinView[]
  family: SpinFamily | 'all'
  rarity: SpinRarity | 'all'
  album: SpinFamily | 'fusion'
  page: number
  /** the reveal ceremony: cards flipped so far */
  flipped: number
  hold: SpinHold | null
  /** the daily hello banner: the first pane open of each UTC day */
  hello: boolean
  /** one plain feedback line, '' when none */
  message: string
  /** a request in flight: its label (a dim placeholder shows after 300 ms) */
  busy: string | null
  busySince: number
}

export type SpinPrefs = { quiet: boolean; motion: boolean; sound: boolean }

/** Presence toward the next pack: the pane header's meter. */
export type SpinPresence = { minutes: number; need: number; blocked: 'bank' | 'spacing' | null }

/** One request as /spin privacy shows it; the token never appears. */
export type SpinSent = { at: number; method: string; path: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    spinlings: {
      account: SpinAccount
      /** the active world's player, packs, notices, offers and gifts */
      me: SpinMe | null
      cards: SpinCard[]
      signals: SpinSignals
      battle: SpinBattle | null
      moments: SpinMoment[]
      reveal: SpinReveal | null
      social: SpinSocial
      pane: SpinPane
      prefs: SpinPrefs
      presence: SpinPresence
      privacy: SpinSent[]
      /** a minute clock for timers and "today" (moved by the heartbeat) */
      clock: number
    }
  }
}

// Domain types shared by the mod, the server and the tests. See SPEC.md.

export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type Body = 'blob' | 'critter' | 'bird' | 'ghost' | 'bug' | 'wyrm'
export type Pattern = 'none' | 'spots' | 'stripes' | 'belly' | 'mask'
export type Eyes = 'dot' | 'tall' | 'sparkle' | 'sleepy' | 'fierce'
export type Mouth = 'none' | 'smile' | 'fang' | 'o'
export type Trinket = 'none' | 'hat' | 'bow' | 'flower' | 'scarf' | 'monocle'
export type Accessory = 'horns' | 'crown' | 'antennae' | 'halo' | 'spikes' | 'wings'
export type SpecialId = 'flurry' | 'couplet' | 'crescendo' | 'twist'
export type TraitId =
  | 'sturdy' | 'swift' | 'thickHide' | 'luckyStar' | 'quickCharge' | 'glassHeart' | 'regrowth' | 'underdog'
  | 'ambush' | 'moonlit' | 'stubborn' | 'showoff' | 'guardian' | 'sleepy' | 'homebody' | 'mimic'
export type DailyRule =
  | 'haikuDay' | 'sonnetDay' | 'opusDay' | 'fableDay' | 'topsyTurvy' | 'glassDay'
  | 'longDay' | 'gentleDay' | 'wildBloom' | 'shinyHour' | 'fusionFair' | 'calm'
/** 'unknown' only ever appears client-side, as the tolerant reader's fallback for an origin it does not know */
export type CardOrigin =
  | 'starter' | 'pack' | 'catch' | 'bounty' | 'craft' | 'fusion' | 'gift' | 'daily' | 'trader' | 'promo' | 'season' | 'unknown'
export type LeagueName = 'Pebble' | 'Brook' | 'Grove' | 'Peak' | 'Star'
/** Evolution stage (SPEC section 22). Legendaries, Mythics and legendary promos are always 3, their final form. */
export type CardStage = 1 | 2 | 3

export type Stats = { hp: number; atk: number; def: number; spd: number }
/** hp, atk, def, spd genes, each 0..15 */
export type Genes = [number, number, number, number]

/** Uniform random in [0, 1). Always seeded; core never calls Math.random. */
export type Rng = () => number

/** Everything a creature's look and base stats come from: a species, or a card's own embedded form. */
export type Form = {
  family: Family
  body: Body
  hue: number
  pattern: Pattern
  accessory: Accessory
  base: Stats
  /** stage-1, stage-2 and stage-3 names; a final-form creature carries its one name three times */
  names: [string, string, string]
  /** final form: never evolves, always stage 3 */
  legendary: boolean
}

export type Species = Form & {
  /** `s{season}-{family}-{index}` */
  id: string
  season: number
  index: number
}

/** Card species values that carry their own embedded form instead of naming a season species. */
export type CardFormKind = 'fusion' | 'mythic' | 'promo'

/** A form that lives on the card itself (SPEC section 18): a fusion, a Mythic or a drop's promo creature. */
export type CardForm = Form & {
  /** always equal to the card's `species` */
  kind: CardFormKind
  /** fusion only: the parents' species values, A then B */
  parents?: [string, string]
  /** mythic and promo: the seed the creature's parts grow from */
  seed?: string
  /** mythic only, online only: the handle of the player who caught it */
  discoveredBy?: string
  /** promo only: its stamp, e.g. "Founder · Oct 2026" */
  stamp?: string
}

export type Card = {
  id: string
  /** a species id `s{season}-{family}-{index}`, or 'fusion', 'mythic' or 'promo' */
  species: string
  /** present exactly when species is 'fusion', 'mythic' or 'promo' */
  form?: CardForm
  /** Locally resolved frozen species; never accepted from a card request or sent by the mod. */
  appearance?: Form
  /** Locally resolved fusion parents, kept out of the wire and offline save. */
  parentForms?: [Form | null, Form | null]
  season: number
  family: Family
  rarity: Rarity
  shiny: boolean
  /** holographic finish; every legendary and Mythic is foil (SPEC section 14) */
  foil?: true
  /** uint32; cosmetic genes (palette, eyes, mouth, trinket, shape) derive from hashString(species + ':' + dna) */
  dna: number
  genes: Genes
  traits: TraitId[]
  level: number
  xp: number
  stage: CardStage
  /** the arena family it was raised in, fixed at its first evolution (SPEC section 18) */
  raisedIn?: Family
  /** server-computed stats (SPEC section 32); the client shows and simulates these, never recomputing online cards */
  stats: Stats
  bound: boolean
  forTrade: boolean
  origin: CardOrigin
  mintedAt: number
  /** ms epoch; trade-locked until then (0 = free) */
  lockedUntil: number
  /** ms epoch; tired until then (0 = rested) */
  tiredUntil: number
  /** escrow while in an open offer or gift */
  state: 'owned' | 'escrow'
  /** the first card of its species anyone obtained this season (SPEC section 13) */
  firstFind?: true
}

/**
 * The part of a card a battle needs; also how other players' cards are shown (no ownership or timestamps). `raisedIn`
 * is set only on the owner's own cards (ownBattleCard): the arena a card grew up in is never shown to others.
 */
export type BattleCard = Pick<Card,
  'id' | 'species' | 'form' | 'appearance' | 'parentForms' | 'season' | 'family' | 'rarity' | 'shiny' | 'foil' | 'dna' | 'genes' | 'traits'
  | 'level' | 'stage' | 'raisedIn' | 'stats' | 'firstFind'>

/** A freshly minted card: everything but the id, which the server (or the offline save) assigns. */
export type NewCard = Omit<Card, 'id'>

export type BattleKind = 'wild' | 'duel'
export type BattleResult = 'win' | 'loss' | 'draw'

export type BattleSetup = {
  seed: string
  kind: BattleKind
  arena: Family
  rule: DailyRule
  /** the rules version the server simulates with (RULES_VERSION); a mismatch means: animate the server's log */
  rules: number
  attacker: BattleCard[]
  defender: BattleCard[]
}

export type BattleAction = {
  round: number
  side: 'a' | 'd'
  slot: number
  targetSlot: number
  move: 'attack' | 'special'
  special?: SpecialId
  /** the attacker pressed on the round its special fired: 1.3x (SPEC section 5) */
  perfect?: true
  hits: number
  dmg: number
  crit: boolean
  effect: 'super' | 'weak' | 'normal'
  heal: number
  targetFainted: boolean
  /** traits that fired during this action, for flavour lines */
  traits: TraitId[]
}

export type BattleRound = {
  round: number
  actions: BattleAction[]
  /** HP of every slot at the end of the round */
  hp: { a: number[]; d: number[] }
  /** charge of every slot at the end of the round */
  charge: { a: number[]; d: number[] }
  /** active slot at the start of the NEXT round (-1 = none left) */
  active: { a: number; d: number }
  /** the attacker's active special fires on its next action: the band shows `[1] Now!` for the next round */
  attackerSpecialReady: boolean
}

export type BattleLog = {
  rounds: BattleRound[]
  result: BattleResult
  maxHp: { a: number[]; d: number[] }
  /** slots that fainted during the battle */
  fainted: { a: number[]; d: number[] }
}

/** A drop's promo creature (SPEC section 25): one form for everyone, personal DNA for each redeemer. */
export type PromoEgg = { seed: string; name: string; family: Family; rarity: Rarity; foil: boolean; stamp: string }

export type DropRewardItem =
  | { type: 'egg'; promo: PromoEgg }
  | { type: 'pack'; family?: Family; count: number }
  | { type: 'card'; rarity: Rarity; family?: Family }

/** `drops.reward_json`: one reward or several. */
export type DropReward = DropRewardItem | DropRewardItem[]

/** One of the Wandering Trader's daily deals (SPEC section 19). */
export type TraderDeal = {
  /** `{utcDay}-{0..2}` */
  id: string
  name: string
  /** what the player hands over: `count` distinct cards, each matching family and rarity when set */
  give: { count: number; family?: Family; rarity?: Rarity }
  get: { kind: 'cards'; count: number; rarity: Rarity; family: Family } | { kind: 'pack'; count: number; family: Family }
}

// The mod's internal contracts: the Backend both worlds implement, the effects register.tsx injects (Fx), the
// game state (the $.state contract under plain names), the Actions views call, and the slots the band, the pane and
// the offline engine plug into. No $ here: register.tsx is the only file that touches it (SPEC 11).
import type { Elements, RenderElement } from 'claude-code'
import type { ApiErrorCode, ApiOp, ApiRequest, ApiResponse, SpinlingsApi } from '../core/api.ts'
import type { Family } from '../core/types.ts'
import type {
  SpinAccount, SpinBattle, SpinBattleLog, SpinHoldAction, SpinMe, SpinMoment, SpinPane, SpinPrefs, SpinPresence,
  SpinRarity, SpinReveal, SpinSent, SpinSignals, SpinSocial, SpinTab, SpinView, SpinWorld, SpinCard,
} from '../../types/index.d.ts'

export type {
  SpinAccount as Account, SpinBattle as Battle, SpinCatch as Catch, SpinHold as Hold,
  SpinHoldAction as HoldAction, SpinLink as Link, SpinMoment as Moment, SpinOutcome as Outcome, SpinPane as PaneUi,
  SpinPrefs as Prefs, SpinPresence as Presence, SpinReveal as Reveal, SpinSent as Sent, SpinSignals as Signals,
  SpinSignIn as SignIn, SpinSocial as Social, SpinTab as Tab, SpinView as View, SpinWorld as World,
} from '../../types/index.d.ts'

// ---------- backends ----------

/** One rulebook, two backends (SPEC 28): RemoteBackend over HTTP, LocalBackend offline. Both reject with BackendError. */
export type Backend = SpinlingsApi & {
  /** every operation through one door: what RemoteBackend's methods and a test's fake both call */
  call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>>
}

/**
 * Why a call failed. `code` is the server's error code, or one of the client's own: `unavailable` when the server
 * could not be used (no network, a timeout, a redirect, a body over 256 KB, an answer that is not the documented
 * shape); `kind` says which. Offline, operations the local world lacks answer `not_allowed`. `retryAfterMs`: how long
 * the server's Retry-After asked to wait before trying again, or null when it named no wait.
 */
export type FailureKind = 'refused' | 'network' | 'timeout' | 'redirect' | 'too_large' | 'bad_response' | 'unauthorized'
export class BackendError extends Error {
  readonly code: ApiErrorCode
  readonly kind: FailureKind
  readonly status: number
  readonly retryAfterMs: number | null
  constructor(code: ApiErrorCode, kind: FailureKind, status: number, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export function isBackendError(e: unknown): e is BackendError {
  return e instanceof BackendError
}

/** The server could not be used at all (as opposed to it saying no). */
export function isUnreachable(e: unknown): boolean {
  return e instanceof BackendError && (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'redirect' || e.kind === 'too_large'
    || e.kind === 'bad_response' || (e.kind === 'refused' && e.status >= 500))
}

/** What the offline engine (client/local/**) gets: its save under `offline:v1`, time, randomness, the model's family. */
export type LocalDeps = {
  /** the save as stored, or undefined; sessions share the store, so read right before every write */
  load(): Promise<unknown>
  save(save: unknown): Promise<void>
  now(): Promise<number>
  /** uniform [0, 1) from crypto.getRandomValues: offline randomness (SPEC 28) */
  random(): number
  /** the family of the model in use, for a save created on the first me() (the starter team, the welcome packs) */
  family(): Family
}
/** The offline engine's entry point: a Backend implementing every API_ROUTES[op].offline operation, `not_allowed` for the rest. */
export type LocalBackendFactory = (deps: LocalDeps) => Backend

// ---------- effects ----------

export type Timer = { cancel(): void }
/** The four chimes (SPEC 13.12), small WAVs scripts/chimes.ts writes into plugin/assets. */
export type Chime = 'rare' | 'legendary' | 'evolve' | 'first'
export type HttpInit = { method: string; headers: Record<string, string>; body?: string }
export type HttpAnswer = { status: number; ok: boolean; headers: Record<string, string>; text: string }
export type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'

/** The game's state: one $.state value per key (types/index.d.ts). */
export type GameState = {
  account: SpinAccount
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
  clock: number
}
export type StateKey = keyof GameState

/**
 * Everything the game does to the world, injected by register.tsx from `$` (and by tests from fakes). The game
 * itself never reads a clock, rolls a die or touches the network on its own.
 */
export type Fx = {
  /** epoch ms ($.clock.now) */
  now(): Promise<number>
  /** uniform [0, 1) from crypto.getRandomValues */
  random(): number
  /** once, after ms, outside any hook ($.clock.after); timers end with the module (a reload) */
  after(ms: number, fn: () => void): Timer
  every(ms: number, fn: () => void): Timer
  /** one request through $.http.fetch; rejects when the host could not send it */
  fetch(url: string, init: HttpInit): Promise<HttpAnswer>
  store: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  /** $.state: reads one moment; update retries fn on a version conflict, so fn must be pure */
  state: {
    get<K extends StateKey>(key: K): Promise<GameState[K]>
    update<K extends StateKey>(key: K, fn: (v: GameState[K]) => GameState[K]): Promise<GameState[K]>
  }
  ui: {
    toast(text: string): void
    /** the status line; undefined clears it */
    status(text: string | undefined): void
    /** a dim transcript line the model never reads (command output) */
    log(text: string): void
    /**
     * Puts text on the clipboard of the surface the press came from: true only when it got there. A surface may have
     * no way to it yet (the desktop), so a false shows the text to copy by hand and never claims a copy.
     */
    copy(text: string): Promise<boolean>
    /** opens the pane with the keyboard; false when the surface could not place it */
    openPane(): Promise<boolean>
    closePane(): Promise<void>
    /** repaints a mounted Raster of the band or the pane (the last drawn instance) without a render pass */
    blit(site: 'band' | 'pane', key: string, cells: string): Promise<boolean>
    /** one chime, only with sound on and not quiet; never waits, and a failure stays silent */
    sound(cue: Chime): void
  }
}

// ---------- what views get ----------

/** The element table from $.ui.resolve(e), completed: a name the surface lacks draws nothing (Raster on desktop, Svg on terminal). */
export type El = Elements['terminal'] & Pick<Elements['desktop'], 'Svg'>

/** Everything the views can do; each returns once its work settled, errors already shown (pane message or a band line). */
export type Actions = {
  // band
  /** [1] Now!: makes the special firing in the round being animated a Perfect one */
  press(): Promise<void>
  /** catch choice [1]-[3] */
  pickCatch(index: number): Promise<void>
  /** a band moment's primary action ([1] or [o]) */
  act(momentId: string): Promise<void>
  /** esc, Later, or the band's own timer */
  dismiss(momentId: string): Promise<void>

  // pane navigation
  /** opens the pane (from a press, so it seats at any width), optionally on a tab and a view */
  open(to?: { tab?: SpinTab; view?: SpinView }): Promise<void>
  close(): Promise<void>
  tab(tab: SpinTab): Promise<void>
  push(view: SpinView): Promise<void>
  back(): Promise<void>
  /** pane-local changes: filters, page, an offer being built */
  pane(fn: (p: SpinPane) => SpinPane): Promise<void>
  /** starts or completes a 2-second hold (SPEC 21.8): the first press arms, a press after 2 s does it */
  hold(action: SpinHoldAction, target: string): Promise<void>

  // collection
  openPack(packId?: string): Promise<void>
  /** the reveal ceremony: flip the next card, or finish */
  flip(): Promise<void>
  doneReveal(): Promise<void>
  setTeam(cardIds: string[]): Promise<void>
  setForTrade(cardId: string, forTrade: boolean): Promise<void>
  craft(speciesId: string, rarity: SpinRarity): Promise<void>
  buyPack(family?: Family): Promise<void>
  share(cardId?: string): Promise<void>
  /** puts the update command on the clipboard (the footer's version chip); the pane says whether it took */
  copyUpdate(): Promise<void>

  // battles
  /** a duel now (`/spin battle`), or a revenge on a handle from a defense notice */
  duel(revenge?: string): Promise<void>

  // trading (online only; offline shows the one-line "needs the online world")
  profile(handle: string): Promise<void>
  load(what: 'board' | 'trader' | 'leaderboard' | 'devices'): Promise<void>
  offer(to: string, give: string[], get: string[]): Promise<void>
  respond(offerId: string, answer: 'accept' | 'decline'): Promise<void>
  counter(offerId: string, give: string[], get: string[]): Promise<void>
  claim(code: string): Promise<void>
  redeem(code: string): Promise<void>
  wishlist(species: string[]): Promise<void>
  trade(dealId: string, cardIds: string[]): Promise<void>

  // world, account, privacy
  world(world: SpinWorld): Promise<void>
  /** connects to a community server after its one-time notice */
  connect(origin: string): Promise<void>
  passkey(kind: 'add' | 'signin'): Promise<void>
  rerollHandle(): Promise<void>
  leaderboard(optIn: boolean): Promise<void>
  prefs(change: Partial<SpinPrefs>): Promise<void>
}

/** What a view builder gets besides the state it draws. */
export type ViewEnv = {
  el: El
  surface: Surface
  /** cells across (e.props.bodyColumns) */
  columns: number
  /** rows the site may take: the band's maxRows, the pane's bodyRows */
  rows: number
  /** state.clock: the minute clock, for timers and "today" */
  now: number
  actions: Actions
}

export type BandState = Pick<GameState, 'account' | 'me' | 'signals' | 'battle' | 'moments' | 'prefs' | 'cards'>
/** The band (ui/band*.tsx): null when nothing is live, so the engine's own band shows. */
export type BandView = (env: ViewEnv & { state: BandState; isWorking: boolean }) => RenderElement | null
/** The pane (ui/pane*.tsx): always a tree; header, body, hint row on every tab (SPEC 21). */
export type PaneView = (env: ViewEnv & { state: GameState; focused: boolean; placement: 'dock' | 'inline' }) => RenderElement

// ---------- drivers: timed sequences the band and the pane plug in ----------

/** A live battle's controls, handed to the battle driver. Every call reads fresh state. */
export type BattleControl = {
  battle(): Promise<SpinBattle | null>
  /** what to show: core simulateBattle(setup, inputs so far) when live; the server's log (after finishing) when not */
  log(): Promise<SpinBattleLog>
  phase(phase: SpinBattle['phase']): Promise<void>
  /** a state transition: rounds 1..n are on screen */
  show(rounds: number): Promise<void>
  /** ms per round: game.ts ROUND_MS, one pace for every battle */
  paceMs(): Promise<number>
  /** finishes on the server once allowed (finishAfter) and hands the outcome to the band; resolves when done */
  settle(): Promise<void>
}
/** Plays one battle from rustle to settle (client/scheduler.ts). Resolves when the battle is settled or gone. */
export type BattleDriver = (fx: Fx, ctl: BattleControl) => Promise<void>

/** The reveal ceremony's controls, handed to the reveal driver. */
export type RevealControl = {
  reveal(): Promise<SpinReveal | null>
  flipped(): Promise<number>
  /** a state transition: n cards face up */
  flip(n: number): Promise<void>
  /** a state transition: the pack's tear has played, so the strip of backs comes out */
  tear(): Promise<void>
  motion(): Promise<boolean>
}
/** Auto-flips the reveal (every 1.2 s by default, SPEC 13.5); stops when the reveal closes. */
export type RevealDriver = (fx: Fx, ctl: RevealControl) => Promise<void>

/** Animates the band's moments without a battle (the welcome, a ready pack, a present); runs for the module's life. */
export type MomentDriver = (fx: Fx) => Promise<void>

/** What register.tsx's slots hand the game. */
export type Slots = {
  local: LocalBackendFactory
  battle: BattleDriver
  reveal: RevealDriver
  moments: MomentDriver | null
}

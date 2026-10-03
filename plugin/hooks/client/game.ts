// The orchestrator: zero-friction first run (SPEC 34), the two worlds and the switch between them (28), the version
// handshake (32), presence and pack charging (6), waiting battles on the encounter timing (13), the content-blind
// signal handlers (10), and every action the band and the pane can take. Pure in the sense the mod needs: it touches
// the world only through the injected Fx, so it never reads a clock, rolls a die or sends a request on its own.
import type { ApiOp, ApiRequest, ApiResponse, CardsResponse, MeResponse, VersionResponse } from '../core/api.ts'
import { API_ROUTES } from '../core/api.ts'
import type { BattleLog, Card, Family, Rarity } from '../core/types.ts'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../core/battle.ts'
import { cardName, rarityRank } from '../core/cards.ts'
import { ECONOMY, finishAfter, leagueOf } from '../core/economy.ts'
import { FAMILY_INFO, familyOfModel } from '../core/families.ts'
import { parseSeasonResponse } from '../core/schemas.ts'
import { DEFAULT_SERVER } from '../core/servers.ts'
import { GENERATOR_VERSION, installSeason } from '../core/species.ts'
import { emojiMosaic, miniSprite, spriteFor } from '../core/sprite.ts'
import { seasonOf, utcDay } from '../core/world.ts'
import { findCard, parseCommand } from './commands.ts'
import { hostOf, pageUrl, parseSent, pushSent, serverOrigin } from './net.ts'
import {
  CLIENT_VERSION, UPDATE_COMMAND, createRemoteBackend, forgetToken, joinServer, loadToken, saveToken, versionDue, versionStatus,
} from './remote.ts'
import type { RemoteDeps } from './remote.ts'
import {
  HEARTBEAT_MS, REACTION_MS, afterCharge, chargeDue, comfortLine, encounterDue, leaseFor, mayHold, nextCheckIn, reactionLine,
  restingUntil, tickPresence,
} from './session.ts'
import type { ServerMeta, StoredPrefs, StoredPresence } from './store.ts'
import { KEYS, cacheRecord, readCache, readMeta, readOfflineMeta, readPrefs, readPresence, serverKeys } from './store.ts'
import type {
  Account, Actions, Backend, Battle, BattleControl, Catch, Chime, Fx, GameState, HoldAction, Moment, Outcome, Reveal,
  RevealControl, Sent, SignIn, Slots, StateKey, Tab, Timer, View, World,
} from './types.ts'
import { BackendError, isBackendError, isUnreachable } from './types.ts'
import { dayLabel, dots, plural, safe, title } from './text.ts'

const B = ECONOMY.battle
const PANE_REFRESH_MS = 5 * 60_000
const HOLD_MS = 2000
const PACK_READY_MS = 6000
const HINT_MS = 10_000
/** After a failed version handshake, /spin version reports the last answer at once for this long rather than wait again. */
const VERSION_RETRY_MS = 10 * 60_000
/** A picked catch waits this long for its answer before the band lets it go (the request times out sooner). */
const CATCH_WAIT_MS = 20_000
const POLL_MS = ECONOMY.client.pollEveryMs
const OFFLINE_FALLBACK = 'Playing offline · /spin world online when you\'re connected'
const MAX_AGENTS = 32

/**
 * How long a round plays: one pace for every battle. A battle is finished on the server once its rounds have played,
 * so a pace that followed the effort setting would tell the server that setting through the request's timing, and the
 * input window of every round has to have closed before the request leaves (SPEC 15, 20.2).
 */
export const ROUND_MS = ECONOMY.battle.roundMs

// ---------- the initial state of every $.state value ----------

export const ONLINE_FEATURES_UNKNOWN = '*'
export const OFFLINE_FEATURES = ['rivals', 'trader', 'mythics', 'seasons']

export const INITIAL: GameState = {
  account: {
    world: 'online', server: DEFAULT_SERVER, host: hostOf(DEFAULT_SERVER), community: false, link: 'starting', note: '',
    readOnly: false, latest: null, features: [ONLINE_FEATURES_UNKNOWN], signIn: null, devices: null,
  },
  me: null,
  cards: [],
  signals: { family: 'sonnet', working: false, turnStartedAt: null, cheering: 0, restingUntil: null },
  battle: null,
  moments: [],
  reveal: null,
  social: { board: null, profile: null, trader: null, leaderboard: null, gift: null, loading: [] },
  pane: {
    tab: 'team', stack: [], family: 'all', rarity: 'all', album: 'haiku', page: 0, flipped: 0, hold: null, hello: false,
    showUpdate: false, message: '', tone: 'warn', toCopy: '', busy: null, busySince: 0,
  },
  prefs: { quiet: false, motion: true, sound: false },
  presence: { minutes: 0, need: ECONOMY.packs.presenceMinutes, blocked: null },
  privacy: [],
  clock: 0,
}

// ---------- pure helpers the views share ----------

/** A feature the active server lists (or an unknown list, before the handshake). Hidden, not broken, when missing. */
export function hasFeature(account: Account, feature: string): boolean {
  return account.features.includes(ONLINE_FEATURES_UNKNOWN) || account.features.includes(feature)
}

/** Needs the online world: API_ROUTES says the offline backend lacks it. */
export function needsOnline(op: ApiOp): boolean {
  return !API_ROUTES[op].offline
}

/** A card's name at its stage, '?' when its species cannot be read (an unknown season the server has not sent yet). */
export function nameOf(card: Pick<Card, 'species' | 'form' | 'stage'>): string {
  try {
    return safe(cardName(card), 24)
  } catch {
    return '?'
  }
}

/** `soft-otter-42`, `Rival Thistlewick` or `wild Fogmaw`. */
export function opponentLabel(opponent: Battle['opponent'], lead: Pick<Card, 'species' | 'form' | 'stage'> | null): string {
  if (opponent.kind === 'player') return safe(opponent.handle, 40)
  if (opponent.kind === 'rival') return `Rival ${safe(opponent.name, 30)}`
  return lead ? `wild ${nameOf(lead)}` : 'wild creatures'
}

const logs = new Map<string, BattleLog>()

/** What a live battle shows: core simulateBattle(setup, inputs) memoised; the server's log when rules differ. */
export function battleLog(b: Battle): BattleLog | null {
  if (!b.live) return b.log as BattleLog | null
  const key = `${b.id}|${b.inputs.join(',')}`
  let log = logs.get(key)
  if (!log) {
    if (logs.size >= 16) logs.clear()
    log = simulateBattle(b.setup as never, b.inputs)
    logs.set(key, log)
  }
  return log
}

/** The round `[1] Now!` is for: the round being animated when the attacker's special fires in it, else null. */
export function perfectRound(b: Battle | null): number | null {
  if (!b || !b.live || b.phase !== 'fight') return null
  const log = battleLog(b)
  const r = b.shown + 1
  if (!log || r > log.rounds.length || b.inputs.includes(r)) return null
  return perfectRounds(log).includes(r) ? r : null
}

/** The chime a reveal earns (SPEC 13.12): a legendary or a Mythic, a first discovery, then rare and up; else none. */
export function chimeFor(cards: readonly Pick<Card, 'rarity' | 'species' | 'firstFind'>[]): Chime | null {
  if (cards.some(c => c.rarity === 'legendary' || c.species === 'mythic')) return 'legendary'
  if (cards.some(c => c.firstFind)) return 'first'
  if (cards.some(c => c.rarity !== 'common')) return 'rare'
  return null
}

/**
 * The catch options in the order the band offers them, as the server's indexes: the rarest first, then shiny, then
 * the highest level. So `1`, the primary choice, is also the pick made when nobody chooses (SPEC 21.7).
 */
export function catchOrder(options: readonly Pick<Card, 'rarity' | 'shiny' | 'level'>[]): number[] {
  const score = (x: Pick<Card, 'rarity' | 'shiny' | 'level'>) => rarityRank(x.rarity) * 1000 + (x.shiny ? 100 : 0) + x.level
  return options.map((_, i) => i).sort((a, b) => score(options[b]!) - score(options[a]!) || a - b)
}

/** The catch option picked when nobody chooses: the first the band offers. */
export function rarestIndex(options: readonly Pick<Card, 'rarity' | 'shiny' | 'level'>[]): number {
  return catchOrder(options)[0] ?? 0
}

/** Lower shows first; a catch waiting on a choice or an answer goes before everything (headMoment). */
const MOMENT_RANK: Record<Moment['kind'], number> = {
  outcome: 1, evolve: 2, 'pack-ready': 3, present: 4, 'needs-online': 5, server: 5, welcome: 5.5, line: 6, passkey: 8, update: 9,
}

/**
 * The moment the band shows now: a catch choice first, then a result, an evolution, a ready pack, a present, the
 * welcome, a notice, the passkey offer, the update line; the oldest first within a kind. Null when the queue is empty.
 */
export function headMoment(list: readonly Moment[]): Moment | null {
  let best: Moment | null = null
  let rank = Infinity
  for (const m of list) {
    const r = m.kind === 'outcome' && (m.outcome.catch.status === 'choose' || m.outcome.catch.status === 'catching') ? 0
      : m.kind === 'line' && m.tone !== 'notice' ? MOMENT_RANK.line + 0.5 : MOMENT_RANK[m.kind]
    if (r < rank) { best = m; rank = r }
  }
  return best
}

/**
 * The newer mod the active world knows of (SPEC 32): online only, and null while this one is current or before the
 * first handshake. A `$.state` value from before the field existed reads as null.
 */
export function newerMod(account: Pick<Account, 'world'> & { latest?: string | null }): string | null {
  return account.world === 'online' && typeof account.latest === 'string' && account.latest !== '' ? safe(account.latest, 48) : null
}

/**
 * The status line (SPEC 9, 17, 28): the world always shows; never sparks; empty while quiet. A newer mod adds a
 * quiet ` · update 0.2.0` to whatever it says (SPEC 32), in words, never a glyph alone.
 */
export function statusLine(s: Pick<GameState, 'account' | 'me' | 'battle' | 'prefs' | 'signals'>): string | undefined {
  if (s.prefs.quiet) return undefined
  const latest = newerMod(s.account)
  const text = statusText(s)
  return latest ? `${text} · update ${latest}` : text
}

function statusText(s: Pick<GameState, 'account' | 'me' | 'battle' | 'signals'>): string {
  if (s.signals.restingUntil !== null) return `spinlings · ${comfortLine(s.signals.restingUntil)}`
  if (s.battle) {
    const lead = s.battle.setup.defender[0] ?? null
    return `spinlings · ${s.battle.opponent.kind === 'wild' ? opponentLabel(s.battle.opponent, lead) : 'vs ' + opponentLabel(s.battle.opponent, lead)}`
  }
  const world = s.account.world === 'online' ? 'Online' : 'Offline'
  // a signed-out machine's cached packs are not its to open
  const packs = s.account.link === 'signed-out' ? 0 : s.me?.packs.length ?? 0
  return dots('spinlings', world, packs > 0 && plural(packs, 'pack'))
}

/** The spinner's suffix during a battle (SPEC 10): only the phase mode is read, never the spinner's words. */
export function spinnerSuffix(b: Battle | null, base: string, mode: string, quiet: boolean): string | null {
  if (!b || quiet || mode === 'tool-input') return null
  return `${base} · ${opponentLabel(b.opponent, b.setup.defender[0] ?? null)}`
}

/** The share text (SPEC 9): an 8x8 mosaic, the name, family, rarity and finish, and the card page (or "offline save"). */
export function shareText(card: Card, world: World, origin: string): string {
  let mosaic = ''
  try {
    mosaic = emojiMosaic(miniSprite(spriteFor(card)))
  } catch {
    mosaic = ''
  }
  const finish = dots(card.shiny && 'Shiny', card.foil && 'Foil')
  const line = dots(nameOf(card), FAMILY_INFO[card.family].name, title(card.rarity), finish)
  const link = world === 'online' ? pageUrl(origin, 'c', card.id) : `offline save · ${DEFAULT_SERVER}`
  return [mosaic, line, link].filter(s => s !== '').join('\n')
}

/** Plain words for a failure (SPEC 21.5). */
export function failureText(err: unknown, host: string): string {
  if (!isBackendError(err)) return 'Something went wrong. Try again in a moment.'
  switch (err.code) {
    case 'insufficient_sparks': return 'Not enough sparks for that yet.'
    case 'rate_limited': return 'Not just yet. Your team needs a breather.'
    case 'cap_reached': return safe(err.message, 80) || 'There is no room for that right now.'
    case 'not_found': return 'That is not there any more.'
    case 'conflict': return 'That already happened.'
    case 'not_allowed': return 'That can\'t be done here.'
    case 'expired': return 'That has expired.'
    case 'upgrade_required': return `This version is read-only on ${host} · ${UPDATE_COMMAND}`
    case 'unauthorized': return `This computer is signed out of ${host}.`
    case 'unavailable': return isUnreachable(err) ? `Can't reach ${host} right now.` : safe(err.message, 80)
    default: return safe(err.message, 80) || 'That did not work.'
  }
}

/**
 * `/spin version` (SPEC 32): this mod's version and world; online, the server's host and its server, rules and
 * generator versions, then "Up to date." or the update line. Offline names no server, since none is asked.
 */
export function versionReport(account: Pick<Account, 'world' | 'host' | 'community'>, v: VersionResponse | null, client = CLIENT_VERSION): string {
  const ours = (word: string, theirs: number, mine: number) => `${word} ${theirs}${theirs === mine ? '' : ` (this mod: ${mine})`}`
  if (account.world === 'offline') {
    return [`Spinlings ${client} · offline, so no server is asked`, `Rules ${RULES_VERSION} · generator ${GENERATOR_VERSION}`].join('\n')
  }
  const host = safe(account.host, 80)
  const where = `online on ${host}${account.community ? ' (a community server)' : ''}`
  if (!v) return [`Spinlings ${client} · ${where}`, `Can't tell whether an update is out until ${host} answers.`].join('\n')
  const s = versionStatus(v, client)
  // a version is named only when it is a release: a pre-release tag is the server's free text
  const status = s.readOnly ? `Read-only on ${host} until you update${s.target ? ` to ${s.target}` : ''} · ${UPDATE_COMMAND}`
    : s.target ? `Spinlings ${s.target} is out · ${UPDATE_COMMAND}`
    : 'Up to date.'
  return [
    `Spinlings ${client} · ${where} · server ${safe(v.server, 48)}`,
    dots(ours('Rules', v.rules, RULES_VERSION), ours('generator', v.generator, GENERATOR_VERSION)),
    status,
  ].join('\n')
}

/** Far more pages of GET /v1/cards than any collection needs, so a server that never ends cannot hold the mod. */
export const CARD_PAGES = 100

/**
 * Every card, a page at a time (SPEC 32), oldest first. A collection that changed between pages is read again from the
 * start, up to 3 times; one still changing keeps what arrived under the first page's version, so the next refresh,
 * which sees a newer version, reads it again.
 */
export async function allCards(backend: Pick<Backend, 'cards'>): Promise<CardsResponse> {
  for (let tries = 1; ; tries++) {
    const first = await backend.cards({})
    const cards = [...first.cards]
    let { next } = first
    let moved = false
    for (let page = 1; next !== undefined && page < CARD_PAGES && !moved; page++) {
      const more = await backend.cards({ after: next })
      moved = more.version !== first.version
      cards.push(...more.cards)
      next = more.next
    }
    if (!moved || tries === 3) return { cards, version: first.version }
  }
}

// ---------- the game ----------

export type GameOptions = {
  /** the server_url option */
  serverUrl: string
  /** the world option: the first-run world (SPEC 34) */
  world: World
  slots: Slots
  /** test seam */
  remote?: (deps: RemoteDeps) => Backend
}

export type Game = {
  /** session.start, and again after every reload of the module */
  boot(fx: Fx, e: { model: string | null }): Promise<void>
  /** classic.SessionStart after /clear, /resume or /branch: $.state starts over, the module does not */
  reseed(fx: Fx): Promise<void>
  /** session.end: hand the presence lamp back (the whole chain has 1.5 s) */
  end(fx: Fx): Promise<void>
  turnStarted(fx: Fx): Promise<void>
  turnStep(fx: Fx, model: string): Promise<void>
  turnCompleted(fx: Fx, reason: string): Promise<void>
  agentStarted(fx: Fx, agentId: string): Promise<void>
  agentFinished(fx: Fx, agentId: string): Promise<void>
  measured(fx: Fx, limits: readonly { percentUsed: number; resetsAt?: string }[]): Promise<void>
  compacted(fx: Fx, trigger: string): Promise<void>
  heartbeat(fx: Fx): Promise<void>
  command(fx: Fx, args: string): Promise<void>
  /** ui.close for the pane: true keeps it open (esc went back one view) */
  paneClosing(fx: Fx, byPerson: boolean): Promise<boolean>
  actions(fx: Fx): Actions
  /** the band and pane instances last drawn, for blit */
  site(kind: 'band' | 'pane', requestId: string): void
  sites(): { band: string | null; pane: string | null }
}

export function createGame(o: GameOptions): Game {
  // in-memory only; every reload starts these over, and boot() rebuilds what matters from $.state and $.store
  const rt = {
    fx: null as Fx | null,
    holder: '',
    heartbeat: null as Timer | null,
    turnSeq: 0,
    encounter: null as Timer | null,
    driving: null as string | null,
    revealing: null as string | null,
    /** the band's moment driver runs once per load of the module */
    animating: false,
    /**
     * Moves on whenever the world or the server in play changes (setAccount): work begun for the one left behind (a
     * connect, a refresh, the sign-in poll, a battle) sees that, sends nothing more and drops what it brings back.
     */
    place: 0,
    /** the connect under way, and the place it is for */
    connecting: null as { place: number; done: Promise<void> } | null,
    poll: null as Timer | null,
    expiry: new Map<string, Timer>(),
    agents: new Map<string, number>(),
    /** battles whose catch request is in flight in this load of the module */
    catching: new Set<string>(),
    status: null as string | undefined | null,
    /** server clock minus local clock, from the last me() */
    skew: 0,
    lastRefresh: 0,
    /** when the last version handshake failed in this load: /spin version does not wait on another for a while */
    versionFailedAt: -Infinity,
    local: null as Backend | null,
    remote: null as { origin: string; backend: Backend } | null,
    sites: { band: null as string | null, pane: null as string | null },
    family: 'sonnet' as Family,
  }

  const cur = (fx: Fx) => rt.fx ?? fx
  const enter = (fx: Fx) => { rt.fx = fx }

  // ---------- state ----------

  const get = <K extends StateKey>(fx: Fx, k: K) => fx.state.get(k)
  const put = <K extends StateKey>(fx: Fx, k: K, v: GameState[K]) => fx.state.update(k, () => v)
  const upd = <K extends StateKey>(fx: Fx, k: K, fn: (v: GameState[K]) => GameState[K]) => fx.state.update(k, fn)
  const sleep = (fx: Fx, ms: number) => new Promise<void>(r => { fx.after(Math.max(0, ms), r) })
  /**
   * For work about to begin: true while the world and the server in play stay the ones in play now. Taken before the
   * account is read, so a switch landing during that read shows too. State written after an await checks it, inside
   * the update where it can, so nothing lands in a world switched to since (SPEC 28, 33).
   */
  const stays = (): (() => boolean) => {
    const place = rt.place
    return () => rt.place === place
  }

  async function publish(fx: Fx): Promise<void> {
    const [account, me, battle, prefs, signals] = await Promise.all([
      get(fx, 'account'), get(fx, 'me'), get(fx, 'battle'), get(fx, 'prefs'), get(fx, 'signals'),
    ])
    const text = statusLine({ account, me, battle, prefs, signals })
    if (text !== rt.status) {
      rt.status = text
      fx.ui.status(text)
    }
  }

  async function prefsRecord(fx: Fx): Promise<StoredPrefs> {
    return readPrefs(await fx.store.get(KEYS.prefs))
  }
  async function savePrefs(fx: Fx, change: Partial<StoredPrefs>): Promise<StoredPrefs> {
    const next = { ...(await prefsRecord(fx)), ...change }
    await fx.store.set(KEYS.prefs, next)
    return next
  }
  async function metaOf(fx: Fx, origin: string): Promise<ServerMeta> {
    return readMeta(await fx.store.get(KEYS.meta(origin)))
  }
  async function saveMeta(fx: Fx, origin: string, change: Partial<ServerMeta>): Promise<void> {
    await fx.store.set(KEYS.meta(origin), { ...(await metaOf(fx, origin)), ...change })
  }

  // ---------- backends ----------

  function local(): Backend {
    if (!rt.local) {
      rt.local = o.slots.local({
        load: () => rt.fx!.store.get(KEYS.offline),
        save: save => rt.fx!.store.set(KEYS.offline, save),
        now: () => rt.fx!.now(),
        random: () => rt.fx!.random(),
        family: () => rt.family,
      })
    }
    return rt.local
  }

  function remote(origin: string): Backend {
    if (rt.remote?.origin !== origin) {
      const make = o.remote ?? createRemoteBackend
      rt.remote = {
        origin,
        backend: make({
          origin,
          fetch: (url, init) => rt.fx!.fetch(url, init),
          token: () => loadToken(rt.fx!.store, origin),
          now: () => rt.fx!.now(),
          after: (ms, fn) => rt.fx!.after(ms, fn),
          sent: entry => recordSent(rt.fx!, entry),
        }),
      }
    }
    return rt.remote.backend
  }

  /** The active world's backend, its account, and `ok` while that world and server stay in play (stays). */
  async function backendOf(fx: Fx): Promise<{ backend: Backend; account: Account; ok: () => boolean }> {
    const ok = stays()
    const account = await get(fx, 'account')
    return { backend: account.world === 'offline' ? local() : remote(account.server), account, ok }
  }

  async function recordSent(fx: Fx, entry: Sent): Promise<void> {
    const log = pushSent(await get(fx, 'privacy'), entry)
    await put(fx, 'privacy', log)
    await fx.store.set(KEYS.privacy, log)
  }

  // ---------- moments (the band's queue) ----------

  async function pushMoment(fx: Fx, m: Moment): Promise<void> {
    await upd(fx, 'moments', list => [...list.filter(x => x.id !== m.id), m].slice(-16))
    scheduleExpiry(fx, m)
  }

  function scheduleExpiry(fx: Fx, m: Moment): void {
    rt.expiry.get(m.id)?.cancel()
    rt.expiry.delete(m.id)
    if (m.until === null) return
    void fx.now().then(now => {
      rt.expiry.set(m.id, fx.after(Math.max(0, m.until! - now), () => { void expire(cur(fx), m.id) }))
    })
  }

  async function expire(fx: Fx, id: string): Promise<void> {
    rt.expiry.delete(id)
    const now = await fx.now()
    const m = (await get(fx, 'moments')).find(x => x.id === id)
    if (!m || m.until === null || m.until > now + 50) return
    if (m.kind === 'outcome' && m.outcome.catch.status === 'choose') {
      await pickCatch(fx, rarestIndex(m.outcome.catch.options))
      return
    }
    await dropMoment(fx, id)
  }

  async function dropMoment(fx: Fx, id: string): Promise<void> {
    rt.expiry.get(id)?.cancel()
    rt.expiry.delete(id)
    await upd(fx, 'moments', list => list.filter(x => x.id !== id))
  }

  async function line(fx: Fx, text: string, tone: 'hint' | 'reaction' | 'notice' = 'notice', ms: number | null = HINT_MS): Promise<void> {
    const now = await fx.now()
    await pushMoment(fx, { kind: 'line', id: `line:${tone}:${text}`, tone, text, until: ms === null ? null : now + ms })
  }

  /** A hint shown once ever, at the moment it matters (SPEC 21.3). */
  async function hintOnce(fx: Fx, id: string, text: string): Promise<void> {
    const prefs = await prefsRecord(fx)
    if (prefs.hints.includes(id)) return
    await savePrefs(fx, { hints: [...prefs.hints, id] })
    await line(fx, text, 'hint')
  }

  /**
   * On boot: drop what expired while the module was gone, re-arm the rest. A catch whose answer was lost with the old
   * module (a reload mid-request) asks again; the server's catch is one-shot, so a repeat says how it went.
   */
  async function sweepMoments(fx: Fx): Promise<void> {
    const now = await fx.now()
    for (const m of await get(fx, 'moments')) {
      if (m.kind === 'outcome' && m.outcome.catch.status === 'catching' && !rt.catching.has(m.outcome.battleId)) {
        const { battleId } = m.outcome, index = m.outcome.catch.index
        await setCatch(fx, battleId, m.outcome.catch, now + CATCH_WAIT_MS)
        rt.catching.add(battleId)
        fx.after(0, () => { void catchNow(cur(fx), battleId, index, true) })
      } else if (m.until !== null && m.until <= now) await expire(fx, m.id)
      else scheduleExpiry(fx, m)
    }
  }

  // ---------- pane feedback ----------

  /** The pane's one feedback line: a warning unless it says something went right (`good`). */
  async function message(fx: Fx, text: string, tone: 'warn' | 'good' = 'warn'): Promise<void> {
    await upd(fx, 'pane', p => ({ ...p, message: text, tone, busy: null }))
  }

  /**
   * One operation on the active world's backend, with the pane's busy line and plain-words errors. An online-only
   * operation in the offline world shows the one-line "needs the online world" instead (SPEC 28). An answer or a
   * failure that comes back once play moved to another world or server is dropped: the caller gets null.
   */
  async function run<K extends ApiOp>(fx: Fx, op: K, req: ApiRequest<K>, label: string): Promise<ApiResponse<K> | null> {
    const { backend, account, ok } = await backendOf(fx)
    if (account.world === 'offline' && needsOnline(op)) {
      await pushMoment(fx, { kind: 'needs-online', id: 'needs-online', until: (await fx.now()) + HINT_MS })
      await message(fx, 'This needs the online world.')
      return null
    }
    if (account.world === 'online' && account.readOnly && API_ROUTES[op].method !== 'GET') {
      await message(fx, failureText(new BackendError('upgrade_required', 'refused', 426, ''), account.host))
      return null
    }
    const now = await fx.now()
    await upd(fx, 'pane', p => ({ ...p, busy: label, busySince: now, message: '', toCopy: '' }))
    try {
      const res = await backend.call(op, req)
      await upd(fx, 'pane', p => (p.busy === label ? { ...p, busy: null } : p))
      return ok() ? res : null
    } catch (err) {
      if (ok()) await message(fx, failureText(err, account.host))
      await noteFailure(fx, err, ok)
      return null
    }
  }

  /** The server no longer knows this machine's session (unused for 180 days, reset elsewhere, a wiped server). */
  const signedOut = (host: string) => `This computer is signed out of ${host} · /spin world online starts fresh`

  /**
   * A failure that says something about the link itself: the link of the world and server it came from (`ok`), so a
   * request still out when play moved on never marks the world switched to.
   */
  async function noteFailure(fx: Fx, err: unknown, ok: () => boolean): Promise<void> {
    if (!isBackendError(err)) return
    if (err.code === 'unauthorized') await upd(fx, 'account', a => (ok() ? { ...a, link: 'signed-out', note: signedOut(a.host) } : a))
    else if (err.code === 'upgrade_required') await upd(fx, 'account', a => (ok() ? { ...a, readOnly: true } : a))
    else if (isUnreachable(err)) await upd(fx, 'account', a => (ok() ? { ...a, link: a.link === 'ready' ? 'unreachable' : a.link, note: `Can't reach ${a.host} right now` } : a))
  }

  // ---------- me and cards ----------

  /**
   * The player as `origin` answered (null: the offline world), while `ok` says that world and server are still in
   * play; the cache it fills is that origin's alone.
   */
  async function setMe(fx: Fx, me: MeResponse, origin: string | null, ok: () => boolean): Promise<void> {
    const now = await fx.now()
    if (!ok()) return
    let took = false
    const before = await get(fx, 'me')
    await upd(fx, 'me', v => {
      took = ok()
      return took ? me : v
    })
    if (!took) return
    rt.skew = me.now - now
    rt.lastRefresh = now
    if (me.packs.length < ECONOMY.packs.bank) await unblock(fx, 'bank')
    if (origin !== null) {
      const cache = readCache(await fx.store.get(KEYS.cache(origin)))
      await fx.store.set(KEYS.cache(origin), cacheRecord(me, cache?.cards ?? null))
    }
    // a trade accepted while away arrives as a wrapped present (SPEC 13.9)
    if (before) {
      const seen = new Set(before.notices.map(n => n.id))
      for (const n of me.notices) {
        if (!seen.has(n.id) && n.kind === 'offer-accepted' && n.handle) {
          await pushMoment(fx, { kind: 'present', id: `present:${n.id}`, from: n.handle, cardIds: [], until: null })
        }
      }
    }
  }

  /** The collection from `backend`, the world `origin` names (null: offline), unless `ok` says play has moved on. */
  async function loadCards(fx: Fx, backend: Backend, origin: string | null, ok: () => boolean, force = false): Promise<void> {
    const me = await get(fx, 'me')
    const cards = await get(fx, 'cards')
    const cache = origin !== null ? readCache(await fx.store.get(KEYS.cache(origin))) : null
    if (!ok() || (!force && me && cache?.cards && cache.cards.version === me.player.cardsVersion && cards.length > 0)) return
    const res = await allCards(backend)
    let took = false
    await upd(fx, 'cards', v => {
      took = ok()
      return took ? res.cards : v
    })
    if (!took) return
    if (origin !== null && me) await fx.store.set(KEYS.cache(origin), cacheRecord(me, res))
    await ensureSeasons(fx, res.cards)
  }

  /** me, then cards when they moved: after every change and every few minutes. */
  async function refresh(fx: Fx): Promise<void> {
    const { backend, account, ok } = await backendOf(fx)
    const origin = account.world === 'online' ? account.server : null
    try {
      const before = await get(fx, 'me')
      const had = new Set((await get(fx, 'cards')).map(c => c.id))
      const me = await backend.me({})
      await setMe(fx, me, origin, ok)
      await loadCards(fx, backend, origin, ok, !before || before.player.cardsVersion !== me.player.cardsVersion)
      if (ok()) await wrapPresent(fx, had)
      await upd(fx, 'account', a => (ok() && a.link === 'unreachable' ? { ...a, link: 'ready', note: '' } : a))
    } catch (err) {
      await noteFailure(fx, err, ok)
    }
    await publish(fx)
  }

  /**
   * A trade accepted while away arrives as a notice and, in the same refresh, as new cards: they go inside the waiting
   * present, so opening it is a 1-card (or few-card) reveal (SPEC 13.9).
   */
  async function wrapPresent(fx: Fx, had: ReadonlySet<string>): Promise<void> {
    if (had.size === 0) return
    const empty = (await get(fx, 'moments')).filter(m => m.kind === 'present' && m.cardIds.length === 0)
    const target = empty.at(-1)
    if (!target) return
    const fresh = (await get(fx, 'cards')).filter(c => !had.has(c.id)).map(c => c.id).slice(0, 3)
    if (fresh.length === 0) return
    await upd(fx, 'moments', list => list.map(m => (m.id === target.id && m.kind === 'present' ? { ...m, cardIds: fresh } : m)))
  }

  /** Online cards render from the server's frozen species when its generator differs from this mod's (SPEC 32). */
  async function ensureSeasons(fx: Fx, cards: readonly Card[]): Promise<void> {
    const account = await get(fx, 'account')
    if (account.world !== 'online') return
    const meta = await metaOf(fx, account.server)
    if (!meta.version || versionStatus(meta.version).generatorMatch) return
    const now = await fx.now()
    const seasons = [...new Set([seasonOf(now), ...cards.map(c => c.season)])].slice(0, 8)
    for (const season of seasons) {
      try {
        let data = null
        try {
          data = parseSeasonResponse(await fx.store.get(KEYS.season(account.server, season)))
        } catch {
          data = await remote(account.server).season({ season })
          await fx.store.set(KEYS.season(account.server, season), data)
        }
        if (data.season === season) installSeason(season, data.species)
      } catch {
        // a season the server cannot send leaves those cards drawn from this mod's own generator
      }
    }
  }

  // ---------- boot and the first run (SPEC 34) ----------

  async function boot(fx: Fx, e: { model: string | null }): Promise<void> {
    enter(fx)
    const now = await fx.now()
    if (!rt.holder) rt.holder = Math.floor(fx.random() * 2 ** 48).toString(36) + now.toString(36)
    if (e.model) rt.family = familyOfModel(e.model)
    const prefs = await prefsRecord(fx)
    let world: World = prefs.world ?? o.world
    const firstRun = prefs.world === null
    if (prefs.worldOption !== null && prefs.worldOption !== o.world) world = o.world
    // the Server URL option moves play to its server once it changed (or while /spin server never chose one), as /spin
    // server does; until it changes again, /spin server's later choice stands (SPEC 33)
    const option = o.serverUrl.slice(0, 200)
    const optionMoved = prefs.serverOption === null ? prefs.server === null : prefs.serverOption !== option
    const origin = serverOrigin(optionMoved ? o.serverUrl : prefs.server ?? o.serverUrl)
    // setting it in /config is the player's own OK to a community server; the band still says once whose server it is
    const notice = optionMoved && origin !== null && origin !== DEFAULT_SERVER && !prefs.communityOk.includes(origin)
    const was = { world: prefs.world, server: serverOrigin(prefs.server ?? prefs.serverOption ?? o.serverUrl) }
    await savePrefs(fx, {
      world, worldOption: o.world, serverOption: option,
      ...(optionMoved ? { server: origin, communityOk: notice ? [...prefs.communityOk, origin!] : prefs.communityOk } : {}),
    })
    await put(fx, 'prefs', { quiet: prefs.quiet, motion: prefs.motion, sound: prefs.sound })
    await upd(fx, 'signals', s => ({ ...s, family: rt.family }))
    await put(fx, 'clock', now)
    await put(fx, 'privacy', parseSent(await fx.store.get(KEYS.privacy)))
    // a reload into another world or server (an option changed in /config) brings nothing of the old one along: not its
    // collection, its moments, or a battle to finish against the other (SPEC 28, 33)
    const before = await get(fx, 'account')
    const moved = before.world !== world || (world === 'online' && origin !== null && before.server !== origin)
    await setAccount(fx, world, origin)
    if (moved) await clearWorldState(fx)
    if (!firstRun && (world !== was.world || (world === 'online' && origin !== was.server))) await unblock(fx, 'any')
    if (notice) await pushMoment(fx, { kind: 'server', id: `server:${origin}`, origin: origin!, until: null })
    if (world === 'online' && origin && !(await get(fx, 'me'))) {
      const cache = readCache(await fx.store.get(KEYS.cache(origin)))
      if (cache) {
        await put(fx, 'me', cache.me)
        if (cache.cards) await put(fx, 'cards', cache.cards.cards)
      }
    }
    rt.heartbeat?.cancel()
    rt.heartbeat = fx.every(HEARTBEAT_MS, () => { void heartbeat(cur(fx)) })
    await sweepMoments(fx)
    const battle = await get(fx, 'battle')
    if (battle) drive(fx, battle.id)
    const reveal = await get(fx, 'reveal')
    if (reveal) revealDrive(fx, reveal.id)
    if (!rt.animating && o.slots.moments) {
      rt.animating = true
      const driver = o.slots.moments
      fx.after(0, () => { void driver(cur(fx)).catch(() => undefined).finally(() => { rt.animating = false }) })
    }
    await publish(fx)
    // the join and the first answers never hold up the first prompt
    fx.after(0, () => { void connect(cur(fx), { firstRun, explicit: false, fallback: firstRun }) })
  }

  /** Online with a Server URL option Spinlings can't use (setAccount without an origin): no server is asked anything. */
  const badAddress = (a: Account) => a.link === 'unreachable' && a.note.startsWith('The server address')

  async function setAccount(fx: Fx, world: World, origin: string | null): Promise<void> {
    const current = await get(fx, 'account')
    const server = origin ?? current.server
    // offline, the server is only where going online will go: the world in play stays as it is
    const moving = current.world !== world || (world === 'online' && current.server !== server)
    // work for the place being left stops now, and again once the account says so, for any that read it just before
    if (moving) rt.place++
    // a usable address where the option held one that isn't: the link starts over, even on the same server
    const kept = (a: Account) => a.world === world && !(origin && badAddress(a))
    await upd(fx, 'account', a => ({
      ...a, world, server, host: hostOf(server), community: server !== DEFAULT_SERVER,
      link: world === 'online' && !origin ? 'unreachable' : kept(a) && (world === 'offline' || a.server === server) ? a.link : 'starting',
      note: world === 'online' && !origin ? 'The server address in settings is not one Spinlings can use (https only)' : kept(a) ? a.note : '',
      features: world === 'offline' ? OFFLINE_FEATURES : a.world === 'offline' || a.server !== server ? [ONLINE_FEATURES_UNKNOWN] : a.features,
      readOnly: world === 'offline' ? false : a.readOnly,
      // what a server said about newer mods holds for that server alone; the handshake says it again
      latest: world === 'offline' || a.server !== server ? null : a.latest ?? null,
    }))
    if (moving) rt.place++
  }

  async function reseed(fx: Fx): Promise<void> {
    rt.status = null
    await boot(fx, { model: null })
  }

  /**
   * How a connect was asked for: the first run (a failed join plays offline, SPEC 34.4), an explicit switch (a failed
   * join returns to the offline world with a line), or neither (a failure leaves the cache showing as unreachable).
   */
  type How = { firstRun: boolean; explicit: boolean; fallback: boolean }

  /**
   * Brings the active world up: online, a silent join without a session or the stored one; offline, the local save.
   * One connect at a time per world and server: a call for the one under way shares it, and a call after a switch
   * starts its own at once, while the one for the place left behind stops at its next step.
   */
  function connect(fx: Fx, how: How): Promise<void> {
    const place = rt.place
    if (rt.connecting?.place === place) return rt.connecting.done
    const done: Promise<void> = connectNow(fx, how, () => rt.place === place).finally(() => {
      if (rt.connecting?.done === done) rt.connecting = null
    })
    rt.connecting = { place, done }
    return done
  }

  /** The join's pause between slices of its proof of work: once play moved elsewhere the work stops, the join unsent. */
  async function joinPause(fx: Fx, ok: () => boolean): Promise<void> {
    await sleep(fx, 0)
    if (!ok()) throw new BackendError('unavailable', 'refused', 0, 'The join was called off')
  }

  /**
   * One connect, for the world and server in play when it began (`ok`): every network wait is followed by a check, and
   * once play moved on it stops, sends nothing more and writes no state. A join that already went through keeps its
   * session for its own server, which no other world reads.
   */
  async function connectNow(fx: Fx, how: How, ok: () => boolean): Promise<void> {
    const account = await get(fx, 'account')
    if (!ok()) return
    if (account.world === 'offline') return connectOffline(fx, ok)
    if (badAddress(account)) return publish(fx)
    const origin = account.server
    const backend = remote(origin)
    const link = (change: (a: Account) => Partial<Account>) => upd(fx, 'account', a => (ok() ? { ...a, ...change(a) } : a))
    await handshake(fx, origin)
    const meta = await metaOf(fx, origin)
    const token = await loadToken(fx.store, origin)
    if (!ok()) return
    if (!token) {
      if (meta.deleted && !how.explicit) {
        await link(() => ({ link: 'signed-out', note: 'Your online account was deleted · /spin world online starts fresh' }))
        return publish(fx)
      }
      await link(() => ({ link: 'joining', note: '' }))
      try {
        if ((await get(fx, 'account')).readOnly) throw new BackendError('upgrade_required', 'refused', 426, 'This version is too old for the server')
        const joined = await joinServer(backend, rt.family, () => joinPause(fx, ok), ok)
        await saveToken(fx.store, origin, joined.token)
        await saveMeta(fx, origin, { deleted: false, welcomed: false })
        await setMe(fx, joined.me, origin, ok)
        await link(() => ({ link: 'ready', note: '' }))
        await loadCards(fx, backend, origin, ok, true)
      } catch (err) {
        if (!ok()) return
        if (how.fallback) return fallbackOffline(fx, how.firstRun, err, ok)
        await link(a => ({ link: 'unreachable', note: failureText(err, a.host) }))
        return publish(fx)
      }
    } else {
      try {
        await setMe(fx, await backend.me({}), origin, ok)
        await link(() => ({ link: 'ready', note: '' }))
        await loadCards(fx, backend, origin, ok)
      } catch (err) {
        if (isBackendError(err) && err.code === 'unauthorized') await link(a => ({ link: 'signed-out', note: signedOut(a.host) }))
        else await link(a => ({ link: 'unreachable', note: failureText(err, a.host) }))
        return publish(fx)
      }
    }
    if (!ok()) return
    if (!(await metaOf(fx, origin)).version) await handshake(fx, origin)
    if (ok()) await welcome(fx)
    await publish(fx)
  }

  async function connectOffline(fx: Fx, ok: () => boolean): Promise<void> {
    const backend = local()
    try {
      await setMe(fx, await backend.me({}), null, ok)
      await loadCards(fx, backend, null, ok, true)
      await upd(fx, 'account', a => (ok() ? { ...a, link: 'ready', note: '' } : a))
      if (ok()) await welcome(fx)
    } catch (err) {
      // an unreadable save, or one from a newer mod, is left as it is and says so (SPEC 32)
      const note = (isBackendError(err) && safe(err.message, 120)) || 'The offline world could not be opened'
      await upd(fx, 'account', a => (ok() ? { ...a, link: 'unreachable', note } : a))
    }
    await publish(fx)
  }

  /** A join that failed where it should play offline instead (`ok`: the connect it ended is still the one in play). */
  async function fallbackOffline(fx: Fx, firstRun: boolean, err: unknown, ok: () => boolean): Promise<void> {
    const account = await get(fx, 'account')
    if (!ok()) return
    await setAccount(fx, 'offline', account.server)
    const here = stays()
    await savePrefs(fx, { world: 'offline' })
    await clearWorldState(fx)
    await connectOffline(fx, here)
    if (!here()) return
    // on the first run the welcome itself says so, so the payoff is never held back by a line (SPEC 34.3, 34.4)
    const welcoming = firstRun && (await get(fx, 'moments')).some(m => m.kind === 'welcome')
    if (welcoming) await upd(fx, 'moments', list => list.map(m => (m.kind === 'welcome' ? { ...m, note: OFFLINE_FALLBACK } : m)))
    else await line(fx, firstRun ? OFFLINE_FALLBACK : `${failureText(err, account.host)} Still offline.`, 'notice', 15_000)
  }

  /** The welcome (SPEC 34.3): once per world, until acted on or dismissed. */
  async function welcome(fx: Fx): Promise<void> {
    const me = await get(fx, 'me')
    const account = await get(fx, 'account')
    if (!me) return
    const welcomed = account.world === 'offline'
      ? readOfflineMeta(await fx.store.get(KEYS.offlineMeta)).welcomed
      : (await metaOf(fx, account.server)).welcomed
    if (welcomed) return
    const pack = me.packs.find(p => p.source === 'welcome') ?? null
    if (!pack && me.player.battles > 0) return markWelcomed(fx)
    await pushMoment(fx, { kind: 'welcome', id: 'welcome', packId: pack?.id ?? null, until: null })
  }

  async function markWelcomed(fx: Fx): Promise<void> {
    const account = await get(fx, 'account')
    if (account.world === 'offline') {
      await fx.store.set(KEYS.offlineMeta, { ...readOfflineMeta(await fx.store.get(KEYS.offlineMeta)), welcomed: true })
    } else {
      await saveMeta(fx, account.server, { welcomed: true })
    }
  }

  /** The version handshake, once a UTC day (SPEC 32). */
  async function handshake(fx: Fx, origin: string): Promise<void> {
    const now = await fx.now()
    const today = utcDay(now)
    const meta = await metaOf(fx, origin)
    let version = meta.version
    if (!version || versionDue(meta.versionDay, today)) {
      try {
        version = await remote(origin).version({})
        await saveMeta(fx, origin, { version, versionDay: today })
      } catch {
        // an older server without /v1/version, or a blip: keep the last answer
        rt.versionFailedAt = now
      }
    }
    if (!version) return
    const v = versionStatus(version)
    // what a server says holds for that server alone: an answer that lands after a switch is kept in its meta only
    let here = false
    await upd(fx, 'account', a => {
      here = a.world === 'online' && a.server === origin
      return here ? { ...a, readOnly: v.readOnly, features: v.features, latest: v.target } : a
    })
    if (!here) return
    if (v.update) {
      const prefs = await prefsRecord(fx)
      if (prefs.updateSeen !== v.update) {
        await savePrefs(fx, { updateSeen: v.update })
        await pushMoment(fx, { kind: 'update', id: `update:${v.update}`, version: v.update, until: null })
      }
    }
    if (!v.generatorMatch) await ensureSeasons(fx, await get(fx, 'cards'))
  }

  async function clearWorldState(fx: Fx): Promise<void> {
    // a passkey flow belongs to the account it began for: its poll stops, and its page is no longer offered
    rt.poll?.cancel()
    rt.poll = null
    await put(fx, 'me', null)
    await put(fx, 'cards', [])
    await put(fx, 'battle', null)
    await put(fx, 'reveal', null)
    await put(fx, 'social', INITIAL.social)
    await upd(fx, 'moments', list => list.filter(m => m.kind === 'update'))
    await upd(fx, 'pane', p => ({ ...p, stack: [], hold: null, busy: null, message: '', toCopy: '' }))
    await upd(fx, 'account', a => ({ ...a, signIn: null, devices: null }))
  }

  // ---------- signals (SPEC 10) ----------

  async function turnStarted(fx: Fx): Promise<void> {
    enter(fx)
    const now = await fx.now()
    const seq = ++rt.turnSeq
    await upd(fx, 'signals', s => ({ ...s, working: true, turnStartedAt: now }))
    rt.encounter?.cancel()
    rt.encounter = fx.after(nextCheckIn(now, now), () => { void encounterCheck(cur(fx), seq) })
  }

  async function encounterCheck(fx: Fx, seq: number): Promise<void> {
    if (seq !== rt.turnSeq) return
    const signals = await get(fx, 'signals')
    if (!signals.working || signals.turnStartedAt === null) return
    const now = await fx.now()
    const kind = await encounterNow(fx, now, signals.turnStartedAt)
    if (kind) {
      await startBattle(fx, kind)
      return
    }
    if (seq === rt.turnSeq) rt.encounter = fx.after(B.encounterEveryMs, () => { void encounterCheck(cur(fx), seq) })
  }

  async function encounterNow(fx: Fx, now: number, turnStartedAt: number): Promise<'wild' | 'duel' | null> {
    const [prefs, account, me, battle, moments, cards] = await Promise.all([
      get(fx, 'prefs'), get(fx, 'account'), get(fx, 'me'), get(fx, 'battle'), get(fx, 'moments'), get(fx, 'cards'),
    ])
    if (prefs.quiet || account.link !== 'ready' || account.readOnly || battle || !me) return null
    if (moments.some(m => m.kind === 'outcome' && (m.outcome.catch.status === 'choose' || m.outcome.catch.status === 'catching'))) return null
    const server = now + rt.skew
    if (!cards.some(c => c.state === 'owned' && c.tiredUntil <= server)) return null
    const lastDuelAt = account.world === 'offline'
      ? readOfflineMeta(await fx.store.get(KEYS.offlineMeta)).lastDuelAt
      : (await metaOf(fx, account.server)).lastDuelAt
    return encounterDue({
      now: server, turnStartedAt: turnStartedAt + rt.skew, firstEver: me.player.battles === 0, roll: fx.random(), duelRoll: fx.random(),
      nextWildAt: me.player.nextWildAt, nextDuelAt: me.player.nextDuelAt, lastDuelAt,
    })
  }

  async function turnStep(fx: Fx, model: string): Promise<void> {
    const family = familyOfModel(model)
    rt.family = family
    const s = await get(fx, 'signals')
    if (s.family !== family) await upd(fx, 'signals', x => ({ ...x, family }))
  }

  async function turnCompleted(fx: Fx, reason: string): Promise<void> {
    enter(fx)
    rt.turnSeq++
    rt.encounter?.cancel()
    rt.encounter = null
    await upd(fx, 'signals', s => ({ ...s, working: false, turnStartedAt: null }))
    if (reason === 'aborted') await react(fx, 'aborted')
  }

  async function react(fx: Fx, kind: 'aborted' | 'compact'): Promise<void> {
    const [prefs, battle, me, cards] = await Promise.all([get(fx, 'prefs'), get(fx, 'battle'), get(fx, 'me'), get(fx, 'cards')])
    if (prefs.quiet || battle || !me) return
    const lead = cards.find(c => c.id === me.player.team[0])
    if (!lead) return
    await line(fx, reactionLine(kind, nameOf(lead)), 'reaction', REACTION_MS)
  }

  async function agentStarted(fx: Fx, agentId: string): Promise<void> {
    const now = await fx.now()
    for (const [id, at] of rt.agents) if (now - at > 30 * 60_000) rt.agents.delete(id)
    if (rt.agents.size < MAX_AGENTS) rt.agents.set(agentId, now)
    await upd(fx, 'signals', s => ({ ...s, cheering: rt.agents.size }))
  }

  async function agentFinished(fx: Fx, agentId: string): Promise<void> {
    if (!rt.agents.delete(agentId)) return
    await upd(fx, 'signals', s => ({ ...s, cheering: rt.agents.size }))
  }

  async function measured(fx: Fx, limits: readonly { percentUsed: number; resetsAt?: string }[]): Promise<void> {
    const until = restingUntil(limits, await fx.now())
    const s = await get(fx, 'signals')
    if (s.restingUntil !== until) {
      await upd(fx, 'signals', x => ({ ...x, restingUntil: until }))
      await publish(fx)
    }
  }

  async function compacted(fx: Fx, trigger: string): Promise<void> {
    if (trigger !== 'precompute') await react(fx, 'compact')
  }

  // ---------- heartbeat: the clock, presence, a periodic refresh ----------

  async function heartbeat(fx: Fx): Promise<void> {
    const now = await fx.now()
    await put(fx, 'clock', now)
    await upd(fx, 'signals', s => (s.restingUntil !== null && s.restingUntil <= now ? { ...s, restingUntil: null } : s))
    await presenceTick(fx, now)
    const account = await get(fx, 'account')
    if (account.link === 'ready' && now - rt.lastRefresh >= PANE_REFRESH_MS) {
      await refresh(fx)
      // the refresh waited on the network: the handshake and the offer go to the server in play after it, if still this one
      const after = await get(fx, 'account')
      if (account.world === 'online' && after.world === 'online' && after.server === account.server) {
        await handshake(fx, account.server)
        await passkeyOffer(fx, now)
      }
    } else if (account.link === 'unreachable' && account.world === 'online' && now - rt.lastRefresh >= PANE_REFRESH_MS) {
      rt.lastRefresh = now
      await connect(fx, { firstRun: false, explicit: false, fallback: false })
    }
    await publish(fx)
  }

  async function presenceTick(fx: Fx, now: number): Promise<void> {
    let p: StoredPresence = readPresence(await fx.store.get(KEYS.presence))
    if (!mayHold(p.lease, rt.holder, now)) {
      await put(fx, 'presence', { minutes: p.minutes, need: ECONOMY.packs.presenceMinutes, blocked: p.blocked })
      return
    }
    p = tickPresence({ ...p, lease: leaseFor(rt.holder, now) }, rt.family, now).presence
    if (p.blocked === 'spacing' && now >= p.blockedUntil) p = { ...p, blocked: null, blockedUntil: 0 }
    await fx.store.set(KEYS.presence, p)
    await put(fx, 'presence', { minutes: p.minutes, need: ECONOMY.packs.presenceMinutes, blocked: p.blocked })
    const family = chargeDue(p, rt.family, now)
    const account = await get(fx, 'account')
    if (family && account.link === 'ready' && !account.readOnly) await charge(fx, family, p, now)
  }

  async function charge(fx: Fx, family: Family, p: StoredPresence, now: number): Promise<void> {
    const { backend, ok } = await backendOf(fx)
    let next: StoredPresence
    try {
      const res = await backend.chargePack({ family })
      next = afterCharge(p)
      await upd(fx, 'me', me => (me && ok() ? { ...me, packs: res.packs } : me))
      if (ok() && !(await get(fx, 'prefs')).quiet) {
        await pushMoment(fx, { kind: 'pack-ready', id: 'pack-ready', count: res.packs.length, until: now + PACK_READY_MS })
      }
    } catch (err) {
      if (isBackendError(err) && err.code === 'cap_reached') next = { ...p, blocked: 'bank' }
      else if (isBackendError(err) && err.code === 'rate_limited') {
        const me = await get(fx, 'me')
        const at = me ? me.player.nextChargeAt - rt.skew : 0
        next = { ...p, blocked: 'spacing', blockedUntil: at > now ? at : now + 15 * 60_000 }
      } else {
        next = { ...p, blocked: 'spacing', blockedUntil: now + 5 * 60_000 }
        await noteFailure(fx, err, ok)
      }
    }
    const fresh = readPresence(await fx.store.get(KEYS.presence))
    await fx.store.set(KEYS.presence, { ...next, lease: fresh.lease, lastMinute: Math.max(fresh.lastMinute, next.lastMinute) })
    await put(fx, 'presence', { minutes: next.minutes, need: ECONOMY.packs.presenceMinutes, blocked: next.blocked })
    await publish(fx)
  }

  /**
   * The presence lamp's block is the word of one world's server, kept machine-wide: a full bank lifts as soon as the
   * world in play has room (another world, packs opened elsewhere), and a switch of world or server lifts any block.
   */
  async function unblock(fx: Fx, which: 'bank' | 'any'): Promise<void> {
    const lifts = (b: StoredPresence['blocked']) => b !== null && (which === 'any' || b === which)
    const p = readPresence(await fx.store.get(KEYS.presence))
    if (lifts(p.blocked)) await fx.store.set(KEYS.presence, { ...p, blocked: null, blockedUntil: 0 })
    await upd(fx, 'presence', x => (lifts(x.blocked) ? { ...x, blocked: null } : x))
  }

  async function end(fx: Fx): Promise<void> {
    rt.heartbeat?.cancel()
    const p = readPresence(await fx.store.get(KEYS.presence))
    if (p.lease?.holder === rt.holder) await fx.store.set(KEYS.presence, { ...p, lease: null })
  }

  async function passkeyOffer(fx: Fx, now: number): Promise<void> {
    const [account, me] = await Promise.all([get(fx, 'account'), get(fx, 'me')])
    if (!me || !hasFeature(account, 'passkey')) return
    const meta = await metaOf(fx, account.server)
    const today = utcDay(now)
    const third = Date.parse(me.player.joinedDay + 'T00:00:00Z') + 3 * 86_400_000 <= now
    const weekAgo = meta.passkeyDay === '' || Date.parse(meta.passkeyDay + 'T00:00:00Z') + 7 * 86_400_000 <= now
    if (!third || !weekAgo || meta.passkeyDay === 'saved') return
    await saveMeta(fx, account.server, { passkeyDay: today })
    await pushMoment(fx, { kind: 'passkey', id: 'passkey', until: null })
  }

  // ---------- battles ----------

  async function startBattle(fx: Fx, kind: 'wild' | 'duel', revenge?: string): Promise<void> {
    if (await get(fx, 'battle')) return
    const { backend, account, ok } = await backendOf(fx)
    if (account.link !== 'ready') return
    if (account.world === 'online' && account.readOnly) {
      if (kind === 'duel') await line(fx, failureText(new BackendError('upgrade_required', 'refused', 426, ''), account.host), 'notice', HINT_MS)
      return
    }
    const req: ApiRequest<'startBattle'> = revenge ? { kind, family: rt.family, revenge } : { kind, family: rt.family }
    let res
    try {
      res = await backend.startBattle(req)
    } catch (err) {
      if (kind === 'duel' && ok()) await line(fx, failureText(err, account.host), 'notice', HINT_MS)
      await noteFailure(fx, err, ok)
      return
    }
    // begun in a world play has since left: never shown or finished here; left open, it settles on its own where it began
    if (!ok()) return
    const now = await fx.now()
    if (kind === 'duel') {
      if (account.world === 'offline') await fx.store.set(KEYS.offlineMeta, { ...readOfflineMeta(await fx.store.get(KEYS.offlineMeta)), lastDuelAt: now })
      else await saveMeta(fx, account.server, { lastDuelAt: now })
    }
    const battle: Battle = {
      id: res.id, setup: res.setup, opponent: res.opponent, subs: res.subs, firstPossible: res.firstPossible,
      startedAt: res.startedAt - rt.skew, finishAfter: res.finishAfter - rt.skew,
      live: res.setup.rules === RULES_VERSION, phase: 'rustle', shown: 0, inputs: [], log: null,
    }
    await put(fx, 'battle', battle)
    await publish(fx)
    drive(fx, battle.id)
  }

  function drive(fx: Fx, id: string): void {
    if (rt.driving === id) return
    rt.driving = id
    // a battle is finished by the world and server it began in, never by one switched to while it played
    const ok = stays()
    const pending: { res: ApiResponse<'finishBattle'> | null } = { res: null }
    const ctl: BattleControl = {
      battle: async () => { const b = await get(cur(fx), 'battle'); return b && b.id === id ? b : null },
      log: async () => {
        const b = await ctl.battle()
        if (!b) return { rounds: [], result: 'draw', maxHp: { a: [], d: [] }, fainted: { a: [], d: [] } }
        if (b.live) return battleLog(b)!
        if (!b.log) {
          pending.res = await finish(cur(fx), b, ok)
          if (pending.res) await upd(cur(fx), 'battle', x => (x && x.id === id ? { ...x, log: pending.res!.log } : x))
        }
        return ((await ctl.battle())?.log ?? pending.res?.log ?? { rounds: [], result: 'draw', maxHp: { a: [], d: [] }, fainted: { a: [], d: [] } }) as BattleLog
      },
      phase: async phase => {
        const b = await upd(cur(fx), 'battle', x => (x && x.id === id ? { ...x, phase } : x))
        const lead = b && b.id === id && phase === 'reveal' ? b.setup.defender[0] : undefined
        const cue = lead && b!.setup.kind === 'wild' ? chimeFor([lead]) : null
        if (cue) cur(fx).ui.sound(cue)
      },
      show: async n => { await upd(cur(fx), 'battle', b => (b && b.id === id ? { ...b, shown: Math.max(b.shown, n) } : b)) },
      paceMs: async () => ROUND_MS,
      settle: async () => {
        const b = await ctl.battle()
        if (!b) return
        await ctl.phase('finishing')
        const res = pending.res ?? await finish(cur(fx), b, ok)
        await settle(cur(fx), b, res, ok)
      },
    }
    void o.slots.battle(fx, ctl)
      .catch(() => settleAbandoned(cur(fx), id))
      .finally(() => { if (rt.driving === id) rt.driving = null })
  }

  /**
   * Finishes on the server once it allows: no sooner than the rounds the presses play, 1.5 s each after the start, and
   * after a "still playing" answer, once the wait its Retry-After names is over (SPEC 15). It is asked when the rounds
   * have played at ROUND_MS, the same for everyone, so when it is asked says nothing about the effort setting (SPEC
   * 20.2); and only while the world and server the battle began in are still in play (`ok`).
   */
  async function finish(fx: Fx, b: Battle, ok: () => boolean): Promise<ApiResponse<'finishBattle'> | null> {
    const { backend } = await backendOf(fx)
    const inputs = b.live ? (await get(fx, 'battle'))?.inputs ?? b.inputs : []
    const log = b.live ? battleLog({ ...b, inputs }) : null
    const wait = (log ? finishAfter(b.startedAt, log.rounds.length) : b.finishAfter) - (await fx.now())
    if (wait > 0) await sleep(fx, wait + 50)
    // past this the battle is settled on its own, with no presses: waiting longer could not finish it
    const closes = b.startedAt + B.abandonMs
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!ok()) return null
      try {
        return await backend.finishBattle({ battleId: b.id, inputs })
      } catch (err) {
        const retry = isBackendError(err) && err.code === 'conflict' ? err.retryAfterMs : null
        if (retry !== null && attempt < 2 && (await fx.now()) + retry < closes) {
          await sleep(fx, retry + 50)
          continue
        }
        if (isUnreachable(err) && attempt < 2) {
          await sleep(fx, 2000 * (attempt + 1))
          continue
        }
        await noteFailure(fx, err, ok)
        return null
      }
    }
    return null
  }

  async function settleAbandoned(fx: Fx, id: string): Promise<void> {
    const b = await get(fx, 'battle')
    if (b && b.id === id) {
      await put(fx, 'battle', null)
      await line(fx, 'The battle fizzled out. Your team is fine.', 'notice')
    }
    await publish(fx)
  }

  /** Lands a finish in the world and server it was asked of (`ok`): once play moved on, its outcome and catch go nowhere. */
  async function settle(fx: Fx, b: Battle, res: ApiResponse<'finishBattle'> | null, ok: () => boolean): Promise<void> {
    if (!ok()) return
    if (!res) {
      await settleAbandoned(fx, b.id)
      await refresh(fx)
      return
    }
    const now = await fx.now()
    const me = await get(fx, 'me')
    const cards = await get(fx, 'cards')
    const lead = b.setup.defender[0] ?? null
    const mythic = lead?.species === 'mythic'
    const won = res.result === 'win'
    let c: Catch = { status: 'none' }
    if (b.setup.kind === 'wild') {
      if (won && res.catchOptions.length > 1) c = { status: 'choose', options: res.catchOptions, deadline: now + B.catchAutoPickMs }
      else if (won && res.catchOptions.length === 1) c = { status: 'catching', options: res.catchOptions, index: 0 }
      else if (won) c = { status: 'slipped' }
      else if (mythic) c = { status: 'fled' }
    }
    const before = me ? leagueOf(me.player.rating).name : null
    const after = leagueOf(res.rating).name
    const outcome: Outcome = {
      battleId: b.id, kind: b.setup.kind, opponent: b.opponent, lead, result: res.result, sparks: res.sparks, rating: res.rating,
      ratingDelta: res.ratingDelta, league: b.setup.kind === 'duel' && before && before !== after ? { from: before, to: after } : null,
      perfect: (res.log.rounds ?? []).reduce((n, r) => n + r.actions.filter(a => a.perfect).length, 0),
      xp: res.xp, catch: c, bounty: res.bounty, dailyWinPack: res.dailyWinPack, streak: res.streak, streakPack: res.streakPack,
    }
    await put(fx, 'battle', null)
    const until = c.status === 'choose' ? c.deadline : c.status === 'catching' ? now + CATCH_WAIT_MS : now + B.resultBandMs
    await pushMoment(fx, { kind: 'outcome', id: `outcome:${b.id}`, outcome, until })
    for (const x of res.xp) {
      if (!x.evolved) continue
      const card = cards.find(k => k.id === x.cardId)
      if (!card) continue
      const to = nameOf({ ...card, stage: x.stage })
      await pushMoment(fx, { kind: 'evolve', id: `evolve:${x.cardId}:${x.stage}`, cardId: x.cardId, from: nameOf(card), to, stage: x.stage, until: now + B.resultBandMs + 8000 })
    }
    await refresh(fx)
    // the refresh waited on the network: the catch is asked of the battle's own server only if still in play
    if (ok() && c.status === 'catching') await catchNow(fx, b.id, 0)
  }

  async function pickCatch(fx: Fx, index: number): Promise<void> {
    const m = (await get(fx, 'moments')).find(x => x.kind === 'outcome' && x.outcome.catch.status === 'choose')
    if (!m || m.kind !== 'outcome' || m.outcome.catch.status !== 'choose') return
    const options = m.outcome.catch.options
    const i = Math.max(0, Math.min(options.length - 1, Math.floor(index)))
    await setCatch(fx, m.outcome.battleId, { status: 'catching', options, index: i }, (await fx.now()) + CATCH_WAIT_MS)
    await catchNow(fx, m.outcome.battleId, i)
  }

  /** Asks the server for the picked creature (`index` is the server's). `resumed`: asked before a reload lost the answer. */
  async function catchNow(fx: Fx, battleId: string, index: number, resumed = false): Promise<void> {
    rt.catching.add(battleId)
    try {
      const { backend, ok } = await backendOf(fx)
      const now = await fx.now()
      try {
        const { card } = await backend.catchCreature({ battleId, index })
        await setCatch(fx, battleId, { status: 'caught', card }, now + B.resultBandMs)
        await refresh(fx)
      } catch (err) {
        const card = resumed && isBackendError(err) && err.code === 'conflict' ? await caughtBefore(fx, battleId, index) : null
        await setCatch(fx, battleId, card ? { status: 'caught', card } : { status: 'slipped' }, now + B.resultBandMs)
        if (!card) await noteFailure(fx, err, ok)
      }
    } finally {
      rt.catching.delete(battleId)
    }
  }

  /** A catch answered before a reload: the creature is in the collection now (same species and DNA), or it slipped. */
  async function caughtBefore(fx: Fx, battleId: string, index: number): Promise<Card | null> {
    const m = (await get(fx, 'moments')).find(x => x.id === `outcome:${battleId}`)
    const option = m?.kind === 'outcome' && m.outcome.catch.status === 'catching' ? m.outcome.catch.options[index] : undefined
    if (!option) return null
    await refresh(fx)
    return ((await get(fx, 'cards')) as Card[]).find(c => c.origin === 'catch' && c.species === option.species && c.dna === option.dna) ?? null
  }

  async function setCatch(fx: Fx, battleId: string, c: Catch, until: number | null): Promise<void> {
    const id = `outcome:${battleId}`
    const list = await upd(fx, 'moments', ms => ms.map(m => (m.id === id && m.kind === 'outcome' ? { ...m, outcome: { ...m.outcome, catch: c }, until } : m)))
    const m = list.find(x => x.id === id)
    if (m) scheduleExpiry(fx, m)
  }

  async function press(fx: Fx): Promise<void> {
    const b = await get(fx, 'battle')
    const r = perfectRound(b)
    if (r === null) return
    await upd(fx, 'battle', x => (x && x.id === b!.id && !x.inputs.includes(r) ? { ...x, inputs: [...x.inputs, r].sort((p, q) => p - q) } : x))
  }

  // ---------- packs and reveals ----------

  async function openPack(fx: Fx, packId?: string): Promise<void> {
    const me = await get(fx, 'me')
    if (!me) return
    const pack = packId ? me.packs.find(p => p.id === packId) : [...me.packs].sort((a, b) => (a.source === 'welcome' ? -1 : 0) - (b.source === 'welcome' ? -1 : 0))[0]
    if (!pack) {
      await message(fx, 'No packs waiting. The next one charges while you work.')
      return
    }
    const res = await run(fx, 'openPack', { packId: pack.id }, 'Opening the pack')
    if (!res) return
    await showReveal(fx, 'pack', pack.family, res.cards, [], me.player.seen)
    await upd(fx, 'me', m => (m ? { ...m, packs: m.packs.filter(p => p.id !== pack.id) } : m))
    await refresh(fx)
  }

  async function showReveal(fx: Fx, kind: Reveal['kind'], family: Family | null, cards: Card[], packs: ApiResponse<'redeem'>['packs'],
    seenBefore: readonly string[]): Promise<void> {
    const now = await fx.now()
    const seen = new Set(seenBefore)
    const fresh = [...new Set(cards.map(c => c.species).filter(s => /^s\d/.test(s) && !seen.has(s)))]
    const total = 36
    const before = seenBefore.filter(s => s.startsWith(`s${seasonOf(now)}-`)).length
    const after = before + fresh.filter(s => s.startsWith(`s${seasonOf(now)}-`)).length
    const id = `reveal:${now.toString(36)}`
    await put(fx, 'reveal', { id, kind, family, cards, packs, fresh, album: { before, after, total } })
    await upd(fx, 'pane', p => ({ ...p, flipped: 0, stack: [...p.stack.filter(v => v.kind !== 'reveal'), { kind: 'reveal' }] }))
    revealDrive(fx, id)
  }

  function revealDrive(fx: Fx, id: string): void {
    if (rt.revealing === id) return
    rt.revealing = id
    const ctl: RevealControl = {
      reveal: async () => { const r = await get(cur(fx), 'reveal'); return r && r.id === id ? r : null },
      flipped: async () => (await get(cur(fx), 'pane')).flipped,
      flip: async n => { await flipTo(cur(fx), id, n) },
      tear: async () => { await upd(cur(fx), 'reveal', r => (r && r.id === id && !r.torn ? { ...r, torn: true } : r)) },
      motion: async () => (await get(cur(fx), 'prefs')).motion,
    }
    void o.slots.reveal(fx, ctl).catch(() => undefined).finally(() => { if (rt.revealing === id) rt.revealing = null })
  }

  /** Turns cards face up to `n`, with the chime the newly turned ones earn. */
  async function flipTo(fx: Fx, id: string, n: number): Promise<void> {
    const r = await get(fx, 'reveal')
    if (!r || r.id !== id) return
    const before = (await get(fx, 'pane')).flipped
    const after = Math.min(r.cards.length, Math.max(before, n))
    if (after === before) return
    await upd(fx, 'pane', p => ({ ...p, flipped: Math.max(p.flipped, after) }))
    const cue = chimeFor(r.cards.slice(before, after))
    if (cue) fx.ui.sound(cue)
  }

  async function flip(fx: Fx): Promise<void> {
    const r = await get(fx, 'reveal')
    if (!r) return
    const p = await get(fx, 'pane')
    if (p.flipped < r.cards.length) await flipTo(fx, r.id, p.flipped + 1)
    else await doneReveal(fx)
  }

  async function doneReveal(fx: Fx): Promise<void> {
    const r = await get(fx, 'reveal')
    await put(fx, 'reveal', null)
    await upd(fx, 'pane', p => ({ ...p, flipped: 0, stack: p.stack.filter(v => v.kind !== 'reveal') }))
    const moments = await get(fx, 'moments')
    if (r && moments.some(m => m.kind === 'welcome')) {
      await dropMoment(fx, 'welcome')
      await markWelcomed(fx)
      await hintOnce(fx, 'first-run', 'Creatures find you while Claude works · /spin to open your collection')
    }
  }

  // ---------- the pane ----------

  async function openPane(fx: Fx, to?: { tab?: Tab; view?: View }): Promise<void> {
    const now = await fx.now()
    const prefs = await prefsRecord(fx)
    const today = utcDay(now)
    const hello = prefs.helloDay !== today
    if (hello) await savePrefs(fx, { helloDay: today })
    await upd(fx, 'pane', p => ({
      ...p, hello: p.hello || hello, tab: to?.tab ?? p.tab, showUpdate: to ? false : p.showUpdate,
      stack: to?.view ? [...p.stack.filter(v => v.kind !== to.view!.kind), to.view] : p.stack,
    }))
    await fx.ui.openPane()
  }

  /** esc: the update row first (while it shows), then the view on top, then the pane itself. */
  async function paneClosing(fx: Fx, byPerson: boolean): Promise<boolean> {
    const p = await get(fx, 'pane')
    if (byPerson && p.showUpdate && newerMod(await get(fx, 'account'))) {
      await upd(fx, 'pane', x => ({ ...x, showUpdate: false, message: '', toCopy: '' }))
      return true
    }
    if (byPerson && p.stack.length > 0) {
      const top = p.stack[p.stack.length - 1]!
      if (top.kind === 'reveal') await doneReveal(fx)
      else await upd(fx, 'pane', x => ({ ...x, stack: x.stack.slice(0, -1), hold: null, message: '', toCopy: '' }))
      return true
    }
    await upd(fx, 'pane', x => ({ ...x, hold: null, message: '', toCopy: '', busy: null, hello: false, showUpdate: false }))
    return false
  }

  // ---------- holds (SPEC 21.8) ----------

  async function hold(fx: Fx, action: HoldAction, target: string): Promise<void> {
    const now = await fx.now()
    const p = await get(fx, 'pane')
    if (!p.hold || p.hold.action !== action || p.hold.target !== target) {
      await upd(fx, 'pane', x => ({ ...x, hold: { action, target, startedAt: now }, message: '', toCopy: '' }))
      return
    }
    if (now - p.hold.startedAt < HOLD_MS) return
    await upd(fx, 'pane', x => ({ ...x, hold: null }))
    await doHeld(fx, action, target)
  }

  async function doHeld(fx: Fx, action: HoldAction, target: string): Promise<void> {
    const account = await get(fx, 'account')
    switch (action) {
      case 'recycle': {
        const res = await run(fx, 'recycle', { cardId: target }, 'Recycling')
        if (res) { await message(fx, `+${res.gained} sparks`); await back(fx); await refresh(fx) }
        return
      }
      case 'fuse': {
        const [cardId, otherId] = target.split('|')
        if (!cardId || !otherId) return
        const me = await get(fx, 'me')
        const res = await run(fx, 'fuse', { cardId, otherId }, 'Fusing')
        if (res) {
          await upd(fx, 'pane', p => ({ ...p, stack: p.stack.filter(v => v.kind !== 'fuse' && v.kind !== 'card') }))
          await showReveal(fx, 'egg', res.card.family, [res.card], [], me?.player.seen ?? [])
          await refresh(fx)
        }
        return
      }
      case 'gift': {
        const res = await run(fx, 'gift', { cardId: target }, 'Wrapping the gift')
        if (res) {
          const link = pageUrl(account.server, 'g', res.gift.code)
          // the gift view says it is on the clipboard only when it got there; otherwise it shows both lines to copy
          const copied = await fx.ui.copy(`${link}\n/spin claim ${res.gift.code}`)
          await upd(fx, 'social', s => ({ ...s, gift: { code: res.gift.code, link, cardId: target, copied } }))
          await upd(fx, 'pane', p => ({ ...p, stack: [...p.stack, { kind: 'gift', code: res.gift.code }] }))
          await refresh(fx)
        }
        return
      }
      case 'cancel-offer': {
        if (await run(fx, 'cancelOffer', { offerId: target }, 'Cancelling')) await refresh(fx)
        return
      }
      case 'cancel-gift': {
        if (await run(fx, 'cancelGift', { code: target }, 'Cancelling')) await refresh(fx)
        return
      }
      case 'reset-access': {
        const res = await run(fx, 'resetToken', {}, 'Resetting access')
        if (res) {
          await saveToken(fx.store, account.server, res.token)
          await message(fx, 'Done. Other machines will need to sign in again.')
        }
        return
      }
      case 'delete-account': {
        const res = await run(fx, 'deleteMe', {}, 'Deleting')
        if (!res) return
        if (account.world === 'online') {
          for (const k of serverKeys(await fx.store.keys(), account.server)) await fx.store.delete(k)
          await saveMeta(fx, account.server, { deleted: true })
          await clearWorldState(fx)
          await upd(fx, 'account', a => ({ ...a, link: 'signed-out', note: 'Your online account was deleted · /spin world online starts fresh' }))
        } else {
          await fx.store.delete(KEYS.offline)
          await fx.store.delete(KEYS.offlineMeta)
          rt.local = null
          await clearWorldState(fx)
          await connectOffline(fx, stays())
        }
        await message(fx, 'Deleted.')
        await publish(fx)
        return
      }
      case 'delete-offline': {
        await fx.store.delete(KEYS.offline)
        await fx.store.delete(KEYS.offlineMeta)
        rt.local = null
        if (account.world === 'offline') {
          await clearWorldState(fx)
          await connectOffline(fx, stays())
        }
        await message(fx, 'The offline save is gone.')
        return
      }
    }
  }

  async function back(fx: Fx): Promise<void> {
    await upd(fx, 'pane', p => ({ ...p, stack: p.stack.slice(0, -1), hold: null }))
  }

  // ---------- worlds and servers ----------

  async function switchWorld(fx: Fx, world: World): Promise<void> {
    const account = await get(fx, 'account')
    if (account.world === world) {
      if (world === 'online' && account.link !== 'ready') {
        // a session the server no longer knows only signs out again: this starts fresh with a new one (SPEC 29)
        if (account.link === 'signed-out') {
          await forgetToken(fx.store, account.server)
          await fx.store.delete(KEYS.cache(account.server))
          await clearWorldState(fx)
        }
        await saveMeta(fx, account.server, { deleted: false })
        await connect(fx, { firstRun: false, explicit: true, fallback: false })
      } else fx.ui.log(`Already in the ${world} world.`)
      return
    }
    await savePrefs(fx, { world })
    // the switch itself first: from here, whatever is still on its way from the world left behind is dropped
    await setAccount(fx, world, account.server)
    await clearWorldState(fx)
    await unblock(fx, 'any')
    if (world === 'online') await saveMeta(fx, account.server, { deleted: false })
    await connect(fx, { firstRun: false, explicit: true, fallback: world === 'online' })
    const now = (await get(fx, 'account')).world
    fx.ui.log(now === 'online' ? `Online on ${account.host}.` : 'Offline: nothing leaves this machine.')
  }

  async function setServer(fx: Fx, url: string | null): Promise<void> {
    const account = await get(fx, 'account')
    if (url === null) {
      fx.ui.log(`Server: ${account.host}${account.community ? ' (a community server)' : ''}`)
      return
    }
    const origin = url.toLowerCase() === 'default' ? DEFAULT_SERVER : serverOrigin(url)
    if (!origin) {
      fx.ui.log('That is not a server address Spinlings can use (https only; http for localhost).')
      return
    }
    const prefs = await prefsRecord(fx)
    if (origin !== DEFAULT_SERVER && !prefs.communityOk.includes(origin)) {
      // offline nothing is sent, not even this check (SPEC 28): the server is first asked once play goes online
      const online = account.world === 'online'
      if (online) {
        try {
          await remote(origin).version({})
        } catch (err) {
          fx.ui.log(failureText(err, hostOf(origin)))
          return
        }
      }
      await pushMoment(fx, { kind: 'server', id: `server:${origin}`, origin, until: null })
      fx.ui.log(`${hostOf(origin)} is a community server run by someone else. ${online ? 'See the band to connect.' : 'See the band to use it when you play online.'}`)
      return
    }
    await useServer(fx, origin)
  }

  /**
   * `/spin version`: the report goes to the log. Online it rests on the day's handshake, asked first (with a line
   * saying so) only when today's is missing and the server is not known to be out of reach; otherwise the last answer
   * is reported at once, with the day it came from (SPEC 21.6: never a silent wait). Offline nothing is sent.
   */
  async function versionCommand(fx: Fx): Promise<void> {
    const account = await get(fx, 'account')
    if (account.world === 'offline') {
      fx.ui.log(versionReport(account, null))
      return
    }
    if (badAddress(account)) {
      fx.ui.log(dots(`Spinlings ${CLIENT_VERSION}`, account.note))
      return
    }
    const now = await fx.now()
    const today = utcDay(now)
    const host = safe(account.host, 80)
    let meta = await metaOf(fx, account.server)
    const fresh = !!meta.version && !versionDue(meta.versionDay, today)
    const reachable = account.link !== 'unreachable' && now - rt.versionFailedAt >= VERSION_RETRY_MS
    if (!fresh && reachable) {
      fx.ui.log(`Asking ${host}…`)
      await handshake(fx, account.server)
      meta = await metaOf(fx, account.server)
    }
    const report = versionReport(await get(fx, 'account'), meta.version)
    const stale = !!meta.version && versionDue(meta.versionDay, today)
    fx.ui.log(stale ? `${report}\nCan't reach ${host} right now, so that is its answer from ${dayLabel(meta.versionDay, today)}.` : report)
    await publish(fx)
  }

  async function useServer(fx: Fx, origin: string): Promise<void> {
    const prefs = await prefsRecord(fx)
    await savePrefs(fx, { server: origin, communityOk: origin === DEFAULT_SERVER ? prefs.communityOk : [...new Set([...prefs.communityOk, origin])] })
    await dropMoment(fx, `server:${origin}`)
    const account = await get(fx, 'account')
    // in play already, unless an unusable Server URL option held play back from it: then it connects as a switch does
    if (account.server === origin && !badAddress(account)) return
    // the move first, so what the old server still sends back is dropped; offline only the server to go online to changes
    await setAccount(fx, account.world, origin)
    if (account.world === 'online') {
      await clearWorldState(fx)
      await unblock(fx, 'any')
      await connect(fx, { firstRun: false, explicit: true, fallback: false })
    }
    fx.ui.log(account.world === 'online' ? `Server: ${hostOf(origin)}` : `Server: ${hostOf(origin)}, from when you play online`)
    await publish(fx)
  }

  // ---------- passkeys (SPEC 29, 30) ----------

  /**
   * A passkey flow belongs to the server it began on: it polls that origin alone, and stops (the poll and the page with
   * it) once play moves to another world or server, so its poll id, which collects a session once, goes nowhere else.
   */
  async function passkey(fx: Fx, kind: 'add' | 'signin'): Promise<void> {
    const ok = stays()
    const account = await get(fx, 'account')
    if (account.world !== 'online') {
      await pushMoment(fx, { kind: 'needs-online', id: 'needs-online', until: (await fx.now()) + HINT_MS })
      return
    }
    const origin = account.server
    // the page's link and the poll's progress show in the devices view, wherever the flow was started
    await openPane(fx, { view: { kind: 'devices' } })
    const res = kind === 'add' ? await run(fx, 'passkeyStart', {}, 'Preparing the passkey page') : await run(fx, 'authStart', {}, 'Preparing the sign-in page')
    if (!res || !ok()) return
    const now = await fx.now()
    const signIn: SignIn = { kind, url: res.url, until: now + ECONOMY.server.pollTtlMs, status: 'pending' }
    await upd(fx, 'account', a => (ok() ? { ...a, signIn } : a))
    await dropMoment(fx, 'passkey')
    rt.poll?.cancel()
    const mark = (status: SignIn['status']) => (x: Account) => (ok() && x.signIn?.url === res.url ? { ...x, signIn: { ...x.signIn, status } } : x)
    const tick = async (): Promise<void> => {
      const f = cur(fx)
      const t = await f.now()
      const a = await get(f, 'account')
      if (!ok() || !a.signIn || a.signIn.url !== res.url) return
      if (t >= a.signIn.until) {
        await upd(f, 'account', mark('expired'))
        return
      }
      try {
        const poll = await remote(origin).authPoll({ pollId: res.pollId })
        if (poll.status === 'added') {
          await saveMeta(f, origin, { passkeyDay: 'saved' })
          await upd(f, 'account', mark('added'))
          if (ok()) await loadDevices(f)
          return
        }
        if (poll.status === 'done') {
          // the session it hands over is this origin's, kept whatever happens next; the cache was the old account's
          await f.store.delete(KEYS.cache(origin))
          await saveToken(f.store, origin, poll.token)
          await saveMeta(f, origin, { deleted: false, welcomed: true, passkeyDay: 'saved' })
          if (!ok()) return
          await clearWorldState(f)
          await setMe(f, poll.me, origin, ok)
          await upd(f, 'account', x => (ok() ? { ...x, link: 'ready', note: '', signIn: { ...signIn, status: 'done' } } : x))
          await loadCards(f, remote(origin), origin, ok, true)
          await publish(f)
          return
        }
      } catch (err) {
        if (isBackendError(err) && (err.code === 'not_found' || err.code === 'expired')) {
          await upd(f, 'account', mark('expired'))
          return
        }
      }
      if (ok()) rt.poll = f.after(POLL_MS, () => { void tick() })
    }
    rt.poll = fx.after(POLL_MS, () => { void tick() })
  }

  // ---------- commands ----------

  async function command(fx: Fx, args: string): Promise<void> {
    enter(fx)
    const cmd = parseCommand(args)
    const account = await get(fx, 'account')
    const cards = await get(fx, 'cards') as Card[]
    const pick = (ref: string) => findCard(cards, ref)
    switch (cmd.kind) {
      case 'open': return openPane(fx)
      case 'battle': {
        if (await get(fx, 'battle')) { fx.ui.log('A battle is already under way.'); return }
        if (account.link !== 'ready') { fx.ui.log(account.note || 'Still getting ready…'); return }
        return startBattle(fx, 'duel')
      }
      case 'pack': {
        await openPane(fx)
        return openPack(fx)
      }
      case 'team': {
        const ids: string[] = []
        for (const ref of cmd.refs) {
          const c = pick(ref)
          if ('error' in c) { fx.ui.log(c.error); return }
          ids.push(c.id)
        }
        const res = await run(fx, 'setTeam', { cardIds: ids }, 'Setting the team')
        if (res) { await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, team: res.team } } : m)); fx.ui.log('Team set.') }
        else fx.ui.log((await get(fx, 'pane')).message)
        return
      }
      case 'trade': {
        await openPane(fx, { tab: 'trade', view: { kind: 'profile', handle: cmd.handle, give: [], get: [], counterOf: null } })
        return loadProfile(fx, cmd.handle)
      }
      case 'gift': {
        const c = pick(cmd.ref)
        if ('error' in c) { fx.ui.log(c.error); return }
        return openPane(fx, { tab: 'cards', view: { kind: 'card', cardId: c.id } })
      }
      case 'claim': return claim(fx, cmd.code, true)
      case 'share': return share(fx, cmd.ref, true)
      case 'redeem': return redeem(fx, cmd.code, true)
      case 'world': {
        if (cmd.world === null) { fx.ui.log(`World: ${account.world}${account.world === 'online' ? ' on ' + account.host : ''}`); return }
        return switchWorld(fx, cmd.world)
      }
      case 'devices': {
        await openPane(fx, { view: { kind: 'devices' } })
        await loadDevices(fx)
        return
      }
      case 'quiet': {
        const quiet = cmd.on ?? !(await get(fx, 'prefs')).quiet
        await setPrefs(fx, { quiet })
        fx.ui.log(quiet ? 'Spinlings is quiet. /spin quiet off to play again.' : 'Spinlings is back.')
        return
      }
      case 'motion': {
        await setPrefs(fx, { motion: cmd.on })
        fx.ui.log(cmd.on ? 'Motion on.' : 'Motion off: every change is instant.')
        return
      }
      case 'sound': {
        await setPrefs(fx, { sound: cmd.on })
        fx.ui.log(cmd.on ? 'Sound on.' : 'Sound off.')
        return
      }
      case 'privacy': return openPane(fx, { view: { kind: 'privacy' } })
      case 'server': return setServer(fx, cmd.url)
      case 'version': return versionCommand(fx)
      case 'demo': return openPane(fx, { view: { kind: 'demo', step: 0 } })
      case 'leaderboard': return leaderboardCommand(fx, cmd.on)
      case 'handle': return handleCommand(fx, cmd.reroll)
      case 'help': fx.ui.log(cmd.text); return
    }
  }

  /** `/spin leaderboard`: the top players in the privacy view, where joining lives; `on`/`off` joins or leaves (SPEC 19, 20). */
  async function leaderboardCommand(fx: Fx, on: boolean | null): Promise<void> {
    const account = await get(fx, 'account')
    if (account.world === 'online' && !hasFeature(account, 'leaderboard')) { fx.ui.log(`${account.host} has no leaderboard.`); return }
    if (on === null) {
      await openPane(fx, { view: { kind: 'privacy' } })
      await loading(fx, 'leaderboard', true)
      const res = await run(fx, 'leaderboard', {}, 'Reading the leaderboard')
      await loading(fx, 'leaderboard', false)
      if (res) await upd(fx, 'social', s => ({ ...s, leaderboard: res.top }))
      return
    }
    const res = await run(fx, 'setLeaderboard', { optIn: on }, on ? 'Joining the leaderboard' : 'Leaving the leaderboard')
    if (!res) { fx.ui.log((await get(fx, 'pane')).message); return }
    await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, leaderboard: res.leaderboard } } : m))
    fx.ui.log(res.leaderboard ? 'You are on the leaderboard: handle, league and rating only.' : 'You are off the leaderboard.')
  }

  /** `/spin handle`: the generated handle; `new` draws another, once a week (SPEC 20.1). */
  async function handleCommand(fx: Fx, reroll: boolean): Promise<void> {
    const [account, me] = await Promise.all([get(fx, 'account'), get(fx, 'me')])
    if (account.world === 'offline') {
      fx.ui.log('Offline there is no handle: nobody else sees this collection.')
      return
    }
    if (!me) { fx.ui.log(account.note || 'Still getting ready…'); return }
    if (!reroll) {
      const from = Date.parse(me.player.handleRerollFrom + 'T00:00:00Z')
      const ready = !Number.isFinite(from) || from <= (await fx.now()) + rt.skew
      fx.ui.log(dots(`You are ${safe(me.player.handle, 40)}`, ready ? '/spin handle new draws another' : `a new one can be drawn from ${safe(me.player.handleRerollFrom, 10)}`))
      return
    }
    if (!hasFeature(account, 'handle-reroll')) { fx.ui.log(`${account.host} keeps handles as they are.`); return }
    const res = await run(fx, 'rerollHandle', {}, 'Finding a new name')
    if (!res) { fx.ui.log((await get(fx, 'pane')).message); return }
    await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, handle: res.handle, handleRerollFrom: res.handleRerollFrom } } : m))
    fx.ui.log(`You are now ${safe(res.handle, 40)}.`)
  }

  async function setPrefs(fx: Fx, change: Partial<GameState['prefs']>): Promise<void> {
    const next = await upd(fx, 'prefs', p => ({ ...p, ...change }))
    await savePrefs(fx, next)
    await publish(fx)
  }

  // ---------- social ----------

  async function loading(fx: Fx, what: GameState['social']['loading'][number], on: boolean): Promise<void> {
    await upd(fx, 'social', s => ({ ...s, loading: on ? [...new Set([...s.loading, what])] : s.loading.filter(x => x !== what) }))
  }

  async function loadProfile(fx: Fx, handle: string): Promise<void> {
    await loading(fx, 'profile', true)
    const res = await run(fx, 'profile', { handle }, 'Looking them up')
    await loading(fx, 'profile', false)
    if (res) await upd(fx, 'social', s => ({ ...s, profile: res }))
  }

  async function loadDevices(fx: Fx): Promise<void> {
    await loading(fx, 'devices', true)
    const res = await run(fx, 'devices', {}, 'Counting devices')
    await loading(fx, 'devices', false)
    if (res) {
      await upd(fx, 'account', a => ({ ...a, devices: res }))
      const account = await get(fx, 'account')
      if (res.passkeys > 0) await saveMeta(fx, account.server, { passkeyDay: 'saved' })
    }
  }

  async function claim(fx: Fx, code: string, fromCommand: boolean): Promise<void> {
    const me = await get(fx, 'me')
    const res = await run(fx, 'claim', { code }, 'Unwrapping')
    if (!res) {
      if (fromCommand) fx.ui.log((await get(fx, 'pane')).message)
      return
    }
    await openPane(fx)
    await showReveal(fx, 'present', null, [res.card], [], me?.player.seen ?? [])
    await refresh(fx)
  }

  async function redeem(fx: Fx, code: string, fromCommand: boolean): Promise<void> {
    const me = await get(fx, 'me')
    const res = await run(fx, 'redeem', { code }, 'Redeeming')
    if (!res) {
      if (fromCommand) fx.ui.log((await get(fx, 'pane')).message)
      return
    }
    await openPane(fx)
    await showReveal(fx, res.cards.some(c => c.species === 'promo') ? 'egg' : 'redeem', null, res.cards, res.packs, me?.player.seen ?? [])
    await refresh(fx)
  }

  async function share(fx: Fx, ref: string | null, fromCommand: boolean): Promise<void> {
    const [account, me, cards] = await Promise.all([get(fx, 'account'), get(fx, 'me'), get(fx, 'cards')])
    const found = ref ? findCard(cards as Card[], ref) : (cards as Card[]).find(c => c.id === me?.player.team[0]) ?? cards[0] as Card | undefined
    if (!found || 'error' in found) {
      const why = found && 'error' in found ? found.error : 'No card to share yet.'
      if (fromCommand) fx.ui.log(why)
      else await message(fx, why)
      return
    }
    const text = shareText(found, account.world, account.server)
    const copied = await fx.ui.copy(text)
    const done = `Copied ${nameOf(found)} to share.`
    // where the clipboard is out of reach (a surface with none yet), the text itself shows, to select and copy by hand
    if (fromCommand) fx.ui.log(copied ? done : `To share ${nameOf(found)}, copy this:\n${text}`)
    else if (copied) await upd(fx, 'pane', p => ({ ...p, message: done, tone: 'good', toCopy: '', busy: null }))
    else await upd(fx, 'pane', p => ({ ...p, message: '', toCopy: text, busy: null }))
  }

  // ---------- actions ----------

  function actions(fx: Fx): Actions {
    enter(fx)
    const after = async <T>(work: Promise<T>): Promise<void> => {
      try {
        await work
      } catch (err) {
        await message(fx, failureText(err, (await get(fx, 'account')).host))
      }
      await publish(fx)
    }
    return {
      press: () => after(press(fx)),
      pickCatch: index => after(pickCatch(fx, index)),
      act: id => after(act(fx, id)),
      dismiss: id => after(dismiss(fx, id)),
      open: to => after(openPane(fx, to)),
      close: () => after(fx.ui.closePane()),
      tab: tab => after(upd(fx, 'pane', p => ({ ...p, tab, stack: [], page: 0, hold: null, message: '', toCopy: '', hello: false, showUpdate: false }))),
      push: view => after(upd(fx, 'pane', p => ({ ...p, stack: [...p.stack, view].slice(-8), hold: null, message: '', toCopy: '', showUpdate: false }))),
      back: () => after(paneClosing(fx, true)),
      pane: fn => after(upd(fx, 'pane', fn)),
      hold: (action, target) => after(hold(fx, action, target)),
      openPack: packId => after(openPack(fx, packId)),
      flip: () => after(flip(fx)),
      doneReveal: () => after(doneReveal(fx)),
      setTeam: cardIds => after((async () => {
        const res = await run(fx, 'setTeam', { cardIds }, 'Setting the team')
        if (res) await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, team: res.team } } : m))
      })()),
      setForTrade: (cardId, forTrade) => after((async () => {
        const res = await run(fx, 'setForTrade', { cardId, forTrade }, forTrade ? 'Marking for trade' : 'Keeping it')
        if (res) await upd(fx, 'cards', cs => cs.map(c => (c.id === cardId ? res.card : c)))
      })()),
      craft: (speciesId, rarity: Rarity) => after((async () => {
        const me = await get(fx, 'me')
        const res = await run(fx, 'craft', { speciesId, rarity }, 'Crafting')
        if (res) { await showReveal(fx, 'craft', res.card.family, [res.card], [], me?.player.seen ?? []); await refresh(fx) }
      })()),
      buyPack: family => after((async () => {
        const res = await run(fx, 'buyPack', { family: family ?? rt.family }, 'Buying a pack')
        if (res) { await upd(fx, 'me', m => (m ? { ...m, packs: res.packs } : m)); await refresh(fx) }
      })()),
      share: cardId => after(share(fx, cardId ?? null, false)),
      copyUpdate: () => after((async () => {
        const copied = await fx.ui.copy(UPDATE_COMMAND)
        if (copied) await message(fx, 'Copied. Run it in a terminal.', 'good')
        else await message(fx, 'Select the command below to copy it, then run it in a terminal.')
      })()),
      duel: revenge => after(startBattle(fx, 'duel', revenge)),
      profile: handle => after(loadProfile(fx, handle)),
      load: what => after((async () => {
        if (what === 'devices') return loadDevices(fx)
        await loading(fx, what, true)
        if (what === 'board') { const r = await run(fx, 'board', {}, 'Reading the board'); if (r) await upd(fx, 'social', s => ({ ...s, board: r })) }
        if (what === 'trader') { const r = await run(fx, 'trader', {}, 'Finding the Trader'); if (r) await upd(fx, 'social', s => ({ ...s, trader: r })) }
        if (what === 'leaderboard') { const r = await run(fx, 'leaderboard', {}, 'Reading the leaderboard'); if (r) await upd(fx, 'social', s => ({ ...s, leaderboard: r.top })) }
        await loading(fx, what, false)
      })()),
      offer: (to, give, get_) => after((async () => {
        const res = await run(fx, 'offer', { to, give, get: get_ }, 'Sending the offer')
        if (res) { await message(fx, `Offer sent to ${safe(to, 40)}.`); await back(fx); await refresh(fx) }
      })()),
      respond: (offerId, answer) => after((async () => {
        const res = await run(fx, answer === 'accept' ? 'acceptOffer' : 'declineOffer', { offerId }, answer === 'accept' ? 'Trading' : 'Declining')
        if (res) {
          if (answer === 'accept') {
            const me = await get(fx, 'me')
            await refresh(fx)
            const got = (await get(fx, 'cards')).filter(c => res.offer.give.some(g => g.id === c.id)) as Card[]
            if (got.length > 0) await showReveal(fx, 'present', null, got, [], me?.player.seen ?? [])
          } else await refresh(fx)
        }
      })()),
      counter: (offerId, give, get_) => after((async () => {
        if (await run(fx, 'counterOffer', { offerId, give, get: get_ }, 'Sending the counter')) { await back(fx); await refresh(fx) }
      })()),
      claim: code => after(claim(fx, code, false)),
      redeem: code => after(redeem(fx, code, false)),
      wishlist: species => after((async () => {
        const res = await run(fx, 'setWishlist', { species }, 'Saving the wishlist')
        if (res) await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, wishlist: res.wishlist } } : m))
      })()),
      trade: (dealId, cardIds) => after((async () => {
        const me = await get(fx, 'me')
        const res = await run(fx, 'traderDeal', { dealId, cardIds }, 'Trading with the Trader')
        if (res) {
          await showReveal(fx, 'trader', null, res.cards, res.packs, me?.player.seen ?? [])
          await upd(fx, 'social', s => (s.trader ? { ...s, trader: { ...s.trader, deals: s.trader.deals.map(d => (d.id === dealId ? { ...d, used: true } : d)) } } : s))
          await refresh(fx)
        }
      })()),
      world: w => after(switchWorld(fx, w)),
      connect: origin => after(useServer(fx, origin)),
      passkey: kind => after(passkey(fx, kind)),
      rerollHandle: () => after((async () => {
        const res = await run(fx, 'rerollHandle', {}, 'Finding a new name')
        if (res) await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, handle: res.handle, handleRerollFrom: res.handleRerollFrom } } : m))
      })()),
      leaderboard: optIn => after((async () => {
        const res = await run(fx, 'setLeaderboard', { optIn }, optIn ? 'Joining the leaderboard' : 'Leaving the leaderboard')
        if (res) await upd(fx, 'me', m => (m ? { ...m, player: { ...m.player, leaderboard: res.leaderboard } } : m))
      })()),
      prefs: change => after(setPrefs(fx, change)),
    }
  }

  async function act(fx: Fx, id: string): Promise<void> {
    const m = (await get(fx, 'moments')).find(x => x.id === id)
    if (!m) return
    switch (m.kind) {
      case 'welcome':
        await openPane(fx)
        await openPack(fx, m.packId ?? undefined)
        return
      case 'pack-ready':
        await dropMoment(fx, id)
        await openPane(fx)
        await openPack(fx)
        return
      case 'outcome': {
        if (m.outcome.catch.status === 'choose') return pickCatch(fx, rarestIndex(m.outcome.catch.options))
        await dropMoment(fx, id)
        const c = m.outcome.catch
        return openPane(fx, c.status === 'caught' ? { tab: 'cards', view: { kind: 'card', cardId: c.card.id } } : { tab: 'team' })
      }
      case 'evolve':
        await dropMoment(fx, id)
        return openPane(fx, { tab: 'cards', view: { kind: 'card', cardId: m.cardId } })
      case 'present': {
        await dropMoment(fx, id)
        const cards = (await get(fx, 'cards')).filter(c => m.cardIds.includes(c.id)) as Card[]
        await openPane(fx, { tab: 'trade' })
        // the album already counts what arrived, so nothing is badged NEW that might not be
        if (cards.length > 0) await showReveal(fx, 'present', null, cards, [], (await get(fx, 'me'))?.player.seen ?? [])
        return
      }
      case 'passkey': return passkey(fx, 'add')
      case 'needs-online':
        await dropMoment(fx, id)
        return switchWorld(fx, 'online')
      case 'server': return useServer(fx, m.origin)
      case 'update':
      case 'line':
        return dropMoment(fx, id)
    }
  }

  async function dismiss(fx: Fx, id: string): Promise<void> {
    const m = (await get(fx, 'moments')).find(x => x.id === id)
    if (!m) return
    if (m.kind === 'outcome' && m.outcome.catch.status === 'choose') return pickCatch(fx, rarestIndex(m.outcome.catch.options))
    if (m.kind === 'welcome') await markWelcomed(fx)
    await dropMoment(fx, id)
  }

  return {
    boot, reseed, end, turnStarted, turnStep, turnCompleted, agentStarted, agentFinished, measured, compacted,
    heartbeat: fx => { enter(fx); return heartbeat(fx) },
    command, paneClosing, actions,
    site: (kind, requestId) => { rt.sites[kind] = requestId },
    sites: () => ({ ...rt.sites }),
  }
}

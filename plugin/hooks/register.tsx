// Spinlings: every hook and every $ call of the mod lives in this file (SPEC 11). The hooks read only the shape of the
// session (SPEC 10): the model's family, the effort, whether Claude's main turn runs, subagent counts, rate-limit
// fullness and compaction. Never tool.call, prompt.submit or a permission request; never prompts, answers, files or
// cost. Every hook passes the event on with next(e) and never waits on the network: the join and every request run
// on clock callbacks, outside any hook. client/game.ts holds the game; this file only lends it $ through Fx.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type {
  BandState, BandView, BattleDriver, Chime, El, Fx, GameState, LocalBackendFactory, MomentDriver, PaneView, RevealDriver,
  Slots, StateKey,
} from './client/types.ts'
import { INITIAL, createGame, spinnerSuffix } from './client/game.ts'
import { createLocalBackend } from './client/local/index.ts'
import { momentDriver, playBattle } from './client/scheduler.ts'
import { DEFAULT_SERVER } from './core/servers.ts'
import { band } from './ui/band.tsx'
import { ceremony } from './ui/ceremony.tsx'
import { pane } from './ui/pane.tsx'

// The slots: the band (ui/band*.tsx, client/scheduler.ts), the pane and its ceremonies (ui/pane*.tsx, ui/ceremony*.tsx)
// and the offline world (client/local/**).
const BAND: BandView = band
const BATTLE_DRIVER: BattleDriver = playBattle
const MOMENT_DRIVER: MomentDriver = momentDriver
const PANE: PaneView = pane
const REVEAL_DRIVER: RevealDriver = ceremony
const LOCAL: LocalBackendFactory = createLocalBackend

const SLOTS: Slots = { local: LOCAL, battle: BATTLE_DRIVER, reveal: REVEAL_DRIVER, moments: MOMENT_DRIVER }

/** The chimes scripts/chimes.ts writes: the plugin's own files, nothing fetched (SPEC 13.12). */
const CHIMES: Record<Chime, string> = {
  rare: 'assets/chime-rare.wav',
  legendary: 'assets/chime-legendary.wav',
  evolve: 'assets/chime-evolve.wav',
  first: 'assets/chime-first.wav',
}

const PANE_ID = 'spinlings'

const accountAtom = atom({ plugin: 'spinlings', key: 'account' } as const, INITIAL.account)
const meAtom = atom({ plugin: 'spinlings', key: 'me' } as const, INITIAL.me)
const cardsAtom = atom({ plugin: 'spinlings', key: 'cards' } as const, INITIAL.cards)
const signalsAtom = atom({ plugin: 'spinlings', key: 'signals' } as const, INITIAL.signals)
const battleAtom = atom({ plugin: 'spinlings', key: 'battle' } as const, INITIAL.battle)
const momentsAtom = atom({ plugin: 'spinlings', key: 'moments' } as const, INITIAL.moments)
const revealAtom = atom({ plugin: 'spinlings', key: 'reveal' } as const, INITIAL.reveal)
const socialAtom = atom({ plugin: 'spinlings', key: 'social' } as const, INITIAL.social)
const paneAtom = atom({ plugin: 'spinlings', key: 'pane' } as const, INITIAL.pane)
const prefsAtom = atom({ plugin: 'spinlings', key: 'prefs' } as const, INITIAL.prefs)
const presenceAtom = atom({ plugin: 'spinlings', key: 'presence' } as const, INITIAL.presence)
const privacyAtom = atom({ plugin: 'spinlings', key: 'privacy' } as const, INITIAL.privacy)
const clockAtom = atom({ plugin: 'spinlings', key: 'clock' } as const, INITIAL.clock)

type $ = EngineInterface
type Fn<K extends StateKey> = (v: GameState[K]) => GameState[K]

// ---------- $.state, by key (refs stay literal for the validator) ----------

async function stateGet<K extends StateKey>($: $, key: K): Promise<GameState[K]> {
  switch (key as StateKey) {
    case 'account': return (await read($, accountAtom)) as GameState[K]
    case 'me': return (await read($, meAtom)) as GameState[K]
    case 'cards': return (await read($, cardsAtom)) as GameState[K]
    case 'signals': return (await read($, signalsAtom)) as GameState[K]
    case 'battle': return (await read($, battleAtom)) as GameState[K]
    case 'moments': return (await read($, momentsAtom)) as GameState[K]
    case 'reveal': return (await read($, revealAtom)) as GameState[K]
    case 'social': return (await read($, socialAtom)) as GameState[K]
    case 'pane': return (await read($, paneAtom)) as GameState[K]
    case 'prefs': return (await read($, prefsAtom)) as GameState[K]
    case 'presence': return (await read($, presenceAtom)) as GameState[K]
    case 'privacy': return (await read($, privacyAtom)) as GameState[K]
    case 'clock': return (await read($, clockAtom)) as GameState[K]
  }
  throw new Error(`no state ${String(key)}`)
}

async function stateUpdate<K extends StateKey>($: $, key: K, fn: (v: GameState[K]) => GameState[K]): Promise<GameState[K]> {
  switch (key as StateKey) {
    case 'account': return (await update($, accountAtom, fn as unknown as Fn<'account'>)) as GameState[K]
    case 'me': return (await update($, meAtom, fn as unknown as Fn<'me'>)) as GameState[K]
    case 'cards': return (await update($, cardsAtom, fn as unknown as Fn<'cards'>)) as GameState[K]
    case 'signals': return (await update($, signalsAtom, fn as unknown as Fn<'signals'>)) as GameState[K]
    case 'battle': return (await update($, battleAtom, fn as unknown as Fn<'battle'>)) as GameState[K]
    case 'moments': return (await update($, momentsAtom, fn as unknown as Fn<'moments'>)) as GameState[K]
    case 'reveal': return (await update($, revealAtom, fn as unknown as Fn<'reveal'>)) as GameState[K]
    case 'social': return (await update($, socialAtom, fn as unknown as Fn<'social'>)) as GameState[K]
    case 'pane': return (await update($, paneAtom, fn as unknown as Fn<'pane'>)) as GameState[K]
    case 'prefs': return (await update($, prefsAtom, fn as unknown as Fn<'prefs'>)) as GameState[K]
    case 'presence': return (await update($, presenceAtom, fn as unknown as Fn<'presence'>)) as GameState[K]
    case 'privacy': return (await update($, privacyAtom, fn as unknown as Fn<'privacy'>)) as GameState[K]
    case 'clock': return (await update($, clockAtom, fn as unknown as Fn<'clock'>)) as GameState[K]
  }
  throw new Error(`no state ${String(key)}`)
}

async function readAll($: $): Promise<GameState> {
  const [account, me, cards, signals, battle, moments, reveal, social, pane, prefs, presence, privacy, clock] = await Promise.all([
    read($, accountAtom), read($, meAtom), read($, cardsAtom), read($, signalsAtom), read($, battleAtom),
    read($, momentsAtom), read($, revealAtom), read($, socialAtom), read($, paneAtom), read($, prefsAtom),
    read($, presenceAtom), read($, privacyAtom), read($, clockAtom),
  ])
  return { account, me, cards, signals, battle, moments, reveal, social, pane, prefs, presence, privacy, clock } as GameState
}

/** What the band draws from: it redraws when one of these moves, never for the pane's own state. */
async function readBand($: $): Promise<BandState & { clock: number }> {
  const [account, me, cards, signals, battle, moments, prefs, clock] = await Promise.all([
    read($, accountAtom), read($, meAtom), read($, cardsAtom), read($, signalsAtom), read($, battleAtom), read($, momentsAtom),
    read($, prefsAtom), read($, clockAtom),
  ])
  return { account, me, cards, signals, battle, moments, prefs, clock } as BandState & { clock: number }
}

// ---------- effects: the only door from the game to $ ----------

function random(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32
}

/** Off by default; quiet silences it too. Playback runs on its own and a failure stays silent. */
async function chime($: $, cue: Chime): Promise<void> {
  try {
    const prefs = await read($, prefsAtom)
    if (!prefs.sound || prefs.quiet) return
    await $.audio.play({ asset: CHIMES[cue] }, { gain: 0.8 })
  } catch {
    // no player on this machine, or the clip could not play
  }
}

async function blit($: $, requestId: string | null, key: string, cells: string): Promise<boolean> {
  if (!requestId) return false
  try {
    return !(await $.ui.blit({ requestId, key, cells })).deny
  } catch {
    return false
  }
}

function fxOf($: $): Fx {
  return {
    now: () => $.clock.now(),
    random,
    after: (ms, fn) => $.clock.after(Math.max(0, Math.round(ms)), fn),
    every: (ms, fn) => $.clock.every(Math.max(1, Math.round(ms)), fn),
    fetch: async (url, init) => {
      const res = await $.http.fetch(url, init)
      return { status: res.status, ok: res.ok, headers: res.headers, text: res.text }
    },
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
      keys: async () => [...(await $.store.keys())],
    },
    state: {
      get: key => stateGet($, key),
      update: (key, fn) => stateUpdate($, key, fn),
    },
    ui: {
      toast: text => $.ui.toast(text),
      status: text => $.ui.status(text),
      log: text => $.ui.log(text),
      copy: async text => {
        try {
          return (await $.ui.copy({ text })).isCopied
        } catch {
          return false
        }
      },
      openPane: async () => {
        try {
          return (await $.ui.open({ id: PANE_ID, title: 'Spinlings', focus: true, closeOnEscape: true })).isPlaced
        } catch {
          return false
        }
      },
      closePane: async () => {
        try {
          await $.ui.close({ id: PANE_ID })
        } catch {
          // already closed
        }
      },
      blit: (site, key, cells) => blit($, game.sites()[site], key, cells),
      sound: cue => { void chime($, cue) },
    },
  }
}

/** Runs a hook's own work so that nothing it does can stop the event: failures go to the debug log only. */
async function quietly($: $, what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (err) {
    $.ui.log(`spinlings: ${what} skipped (${err instanceof Error ? err.name : 'error'})`, { to: 'debug' })
  }
}

async function modelOf($: $): Promise<string | null> {
  try {
    return await $.session.model()
  } catch {
    return null
  }
}

let game = createGame({ serverUrl: DEFAULT_SERVER, world: 'online', slots: SLOTS })

export const register: Register = (on, options) => {
  game = createGame({
    serverUrl: typeof options.server_url === 'string' && options.server_url.trim() !== '' ? options.server_url : DEFAULT_SERVER,
    world: options.world === 'offline' ? 'offline' : 'online',
    slots: SLOTS,
  })

  on('session.start', async ($, e, next) => {
    await quietly($, 'command', () => $.command.register({ name: 'spin', description: 'Spinlings: your team, cards, album and trades', argumentHint: '[battle | pack | team | trade | gift | claim | world | quiet | privacy | …]', immediate: true }))
    const model = await modelOf($)
    await quietly($, 'boot', () => game.boot(fxOf($), { model }))
    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await quietly($, 'reseed', () => game.reseed(fxOf($)))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await quietly($, 'end', () => game.end(fxOf($)))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await quietly($, 'turn', () => game.turnStarted(fxOf($)))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await quietly($, 'step', () => game.turnStep(fxOf($), e.model, e.effort))
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await quietly($, 'turn', () => game.turnCompleted(fxOf($), e.reason))
    else { const id = e.agentId; await quietly($, 'agent', () => game.agentFinished(fxOf($), id)) }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if ('agentId' in r && typeof r.agentId === 'string') { const id = r.agentId; await quietly($, 'agent', () => game.agentStarted(fxOf($), id)) }
    return r
  })

  on('session.measure', async ($, e, next) => {
    // rate-limit fullness only: context fill and cost are never read (SPEC 10)
    const limits = e.rateLimits
    await quietly($, 'measure', () => game.measured(fxOf($), limits))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    const trigger = e.trigger
    await quietly($, 'compact', () => game.compacted(fxOf($), trigger))
    return r
  })

  on('command.run', { command: 'spin' }, async ($, e) => {
    await quietly($, 'command', () => game.command(fxOf($), e.args))
    return {}
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    let keep = false
    await quietly($, 'close', async () => { keep = await game.paneClosing(fxOf($), e.origin.kind === 'person') })
    // answering without next keeps the pane open: esc went back one view
    if (keep) return { value: undefined }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    game.site('band', e.requestId)
    const state = await readBand($)
    const tree = BAND({
      el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows,
      now: state.clock, actions: game.actions(fxOf($)), isWorking: e.props.isWorking, state,
    })
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    game.site('pane', e.requestId)
    const state = await readAll($)
    return PANE({
      el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows,
      now: state.clock, actions: game.actions(fxOf($)), focused: e.props.isFocused, placement: e.props.placement, state,
    })
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const battle = await read($, battleAtom)
    const prefs = await read($, prefsAtom)
    const suffix = spinnerSuffix(battle as GameState['battle'], e.props.suffix, e.props.mode, prefs.quiet)
    return suffix === null ? next(e) : next({ ...e, props: { ...e.props, suffix } })
  })
}

// Spinlings: every hook and every $ call of the mod lives in this file (SPEC 11). The hooks read only the shape of the
// session (SPEC 10): the model's family, local effort glow, whether Claude's main turn runs, subagent counts, rate-limit fullness and
// compaction. Never tool.call, prompt.submit or a permission request; never prompts, answers, files or
// cost. Session and turn hooks pass their events on and never wait on the network: automatic requests run on clock
// callbacks. Explicit game commands and controls may await their requested operation. client/game.ts holds the game;
// this file only lends it $ through Fx.
import { atom } from 'claude-code'
import type { Atom, EngineInterface, Register } from 'claude-code'
import type {
  BandState, BandView, BattleDriver, Chime, El, Fx, GameState, LocalBackendFactory, MomentDriver, PaneView, RevealDriver,
  Slots, StateKey, Surface,
} from './client/types.ts'
import { INITIAL, createGame, spinnerSuffix } from './client/game.ts'
import { chimeClip } from './client/chimes.ts'
import { createLocalBackend } from './client/local/index.ts'
import { momentDriver, playBattle } from './client/scheduler.ts'
import { band } from './ui/band.tsx'
import { ceremony } from './ui/ceremony.tsx'
import { pane } from './ui/pane.tsx'
import { launcher } from './ui/launcher.tsx'
import { prepareCardHit, clearCardHits } from './ui/card-hit-state.ts'

// The slots: the band (ui/band*.tsx, client/scheduler.ts), prompt launcher, pane and its ceremonies
// (ui/pane*.tsx, ui/ceremony*.tsx), and the offline world (client/local/**).
const BAND: BandView = band
const BATTLE_DRIVER: BattleDriver = playBattle
const MOMENT_DRIVER: MomentDriver = momentDriver
const PANE: PaneView = pane
const REVEAL_DRIVER: RevealDriver = ceremony
const LOCAL: LocalBackendFactory = createLocalBackend

const SLOTS: Slots = { local: LOCAL, battle: BATTLE_DRIVER, reveal: REVEAL_DRIVER, moments: MOMENT_DRIVER }

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

type Engine = EngineInterface
type Fn<K extends StateKey> = (v: GameState[K]) => GameState[K]

// ---------- $.state, by key (refs stay literal for the validator) ----------

/** The directory scanner requires plain API calls in this file, including state helper calls. */
async function stateRead($: Engine, key: StateKey): Promise<{ value: unknown; version: number }> {
  switch (key) {
    case 'account': return $.state.get({ plugin: 'spinlings', key: 'account' })
    case 'me': return $.state.get({ plugin: 'spinlings', key: 'me' })
    case 'cards': return $.state.get({ plugin: 'spinlings', key: 'cards' })
    case 'signals': return $.state.get({ plugin: 'spinlings', key: 'signals' })
    case 'battle': return $.state.get({ plugin: 'spinlings', key: 'battle' })
    case 'moments': return $.state.get({ plugin: 'spinlings', key: 'moments' })
    case 'reveal': return $.state.get({ plugin: 'spinlings', key: 'reveal' })
    case 'social': return $.state.get({ plugin: 'spinlings', key: 'social' })
    case 'pane': return $.state.get({ plugin: 'spinlings', key: 'pane' })
    case 'prefs': return $.state.get({ plugin: 'spinlings', key: 'prefs' })
    case 'presence': return $.state.get({ plugin: 'spinlings', key: 'presence' })
    case 'privacy': return $.state.get({ plugin: 'spinlings', key: 'privacy' })
    case 'clock': return $.state.get({ plugin: 'spinlings', key: 'clock' })
  }
  throw new Error(`no state ${String(key)}`)
}

async function stateWrite($: Engine, key: StateKey, value: unknown, version: number): Promise<boolean> {
  switch (key) {
    case 'account': return (await $.state.set({ plugin: 'spinlings', key: 'account' }, value as GameState['account'], { ifVersion: version })).isSet
    case 'me': return (await $.state.set({ plugin: 'spinlings', key: 'me' }, value as GameState['me'], { ifVersion: version })).isSet
    case 'cards': return (await $.state.set({ plugin: 'spinlings', key: 'cards' }, value as GameState['cards'], { ifVersion: version })).isSet
    case 'signals': return (await $.state.set({ plugin: 'spinlings', key: 'signals' }, value as GameState['signals'], { ifVersion: version })).isSet
    case 'battle': return (await $.state.set({ plugin: 'spinlings', key: 'battle' }, value as GameState['battle'], { ifVersion: version })).isSet
    case 'moments': return (await $.state.set({ plugin: 'spinlings', key: 'moments' }, value as GameState['moments'], { ifVersion: version })).isSet
    case 'reveal': return (await $.state.set({ plugin: 'spinlings', key: 'reveal' }, value as GameState['reveal'], { ifVersion: version })).isSet
    case 'social': return (await $.state.set({ plugin: 'spinlings', key: 'social' }, value as GameState['social'], { ifVersion: version })).isSet
    case 'pane': return (await $.state.set({ plugin: 'spinlings', key: 'pane' }, value as GameState['pane'], { ifVersion: version })).isSet
    case 'prefs': return (await $.state.set({ plugin: 'spinlings', key: 'prefs' }, value as GameState['prefs'], { ifVersion: version })).isSet
    case 'presence': return (await $.state.set({ plugin: 'spinlings', key: 'presence' }, value as GameState['presence'], { ifVersion: version })).isSet
    case 'privacy': return (await $.state.set({ plugin: 'spinlings', key: 'privacy' }, value as GameState['privacy'], { ifVersion: version })).isSet
    case 'clock': return (await $.state.set({ plugin: 'spinlings', key: 'clock' }, value as GameState['clock'], { ifVersion: version })).isSet
  }
  throw new Error(`no state ${String(key)}`)
}

/** These atoms have no shape tags; match the SDK's undefined-only initial-value fallback. */
async function read<T>($: Engine, source: Atom<T>): Promise<T> {
  const held = await stateRead($, source.ref.key as StateKey)
  return held.value === undefined ? source.initial : held.value as T
}

/** Match the SDK's atomic update: reread and rerun the pure callback on each version miss, up to 64. */
async function update<T>($: Engine, target: Atom<T>, change: (value: T) => T): Promise<T> {
  for (let tries = 0; tries < 64; tries += 1) {
    const held = await stateRead($, target.ref.key as StateKey)
    const current = held.value === undefined ? target.initial : held.value as T
    const changed = change(current)
    if (await stateWrite($, target.ref.key as StateKey, changed, held.version)) return changed
  }
  throw new Error('update: the value was written by another every time it was read, up ' +
    'to the bound on tries; nothing was written')
}

async function stateGet<K extends StateKey>($: Engine, key: K): Promise<GameState[K]> {
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

async function stateUpdate<K extends StateKey>($: Engine, key: K, fn: (v: GameState[K]) => GameState[K]): Promise<GameState[K]> {
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

async function readAll($: Engine): Promise<GameState> {
  const [account, me, cards, signals, battle, moments, reveal, social, pane, prefs, presence, privacy, clock] = await Promise.all([
    read($, accountAtom), read($, meAtom), read($, cardsAtom), read($, signalsAtom), read($, battleAtom),
    read($, momentsAtom), read($, revealAtom), read($, socialAtom), read($, paneAtom), read($, prefsAtom),
    read($, presenceAtom), read($, privacyAtom), read($, clockAtom),
  ])
  return { account, me, cards, signals, battle, moments, reveal, social, pane, prefs, presence, privacy, clock } as GameState
}

/** The band also watches the inline reveal and its shared flip progress. */
async function readBand($: Engine): Promise<BandState & { clock: number }> {
  const [account, me, cards, signals, battle, moments, prefs, clock, reveal, pane] = await Promise.all([
    read($, accountAtom), read($, meAtom), read($, cardsAtom), read($, signalsAtom), read($, battleAtom), read($, momentsAtom),
    read($, prefsAtom), read($, clockAtom), read($, revealAtom), read($, paneAtom),
  ])
  return { account, me, cards, signals, battle, moments, prefs, clock, reveal, pane } as BandState & { clock: number }
}

// ---------- effects: the only door from the game to $ ----------

function random(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32
}

/** Off by default; quiet silences it too. Playback runs on its own and a failure stays silent. */
async function chime($: Engine, cue: Chime): Promise<void> {
  try {
    const prefs = await read($, prefsAtom)
    if (!prefs.sound || prefs.quiet) return
    await $.audio.play(chimeClip(cue), { gain: 0.8 })
  } catch {
    // no player on this machine, or the clip could not play
  }
}

async function blit($: Engine, requestId: string | null, key: string, cells: string): Promise<boolean> {
  if (!requestId) return false
  try {
    return !(await $.ui.blit({ requestId, key, cells })).deny
  } catch {
    return false
  }
}

/** The effects over `$`; `surface`, where the band or the pane drew, is where their presses copy. */
function fxOf($: Engine, surface?: Surface): Fx {
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
          return (await $.ui.copy(surface ? { text, surface } : { text })).isCopied
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
async function quietly($: Engine, what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (err) {
    $.ui.log(`spinlings: ${what} skipped (${err instanceof Error ? err.name : 'error'})`, { to: 'debug' })
  }
}

async function modelOf($: Engine): Promise<string | null> {
  try {
    return await $.session.model()
  } catch {
    return null
  }
}

let game = createGame({ slots: SLOTS })

// no plugin options: the world and the server are switched with /spin world and /spin server
export const register: Register = on => {
  game = createGame({ slots: SLOTS })

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

  on('agent.spawn', async ($, spawnEvent, continueSpawn) => {
    const spawnResult = await continueSpawn(spawnEvent)
    if ('agentId' in spawnResult && typeof spawnResult.agentId === 'string') { const id = spawnResult.agentId; await quietly($, 'agent', () => game.agentStarted(fxOf($), id)) }
    return spawnResult
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
    clearCardHits(true)
    return next(e)
  })

  on('ui.message', { component: 'Pane', requestId: PANE_ID, module: 'hooks/ui/card-hit.tsx' }, async ($, e, next) => {
    const press = e.surface === 'desktop' ? prepareCardHit(e.element, e.data) : null
    if (press) {
      $.clock.after(0, () => { void quietly($, 'card press', async () => {
        await press(key => $.ui.focus({ requestId: PANE_ID, key }))
      }) })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    game.site('band', e.requestId)
    const state = await readBand($)
    const tree = BAND({
      el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows,
      now: state.clock, actions: game.actions(fxOf($, e.surface)), isWorking: e.props.isWorking, state,
    })
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    game.site('pane', e.requestId)
    const state = await readAll($)
    clearCardHits(e.surface !== 'desktop')
    return PANE({
      el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows,
      now: state.clock, actions: game.actions(fxOf($, e.surface)), focused: e.props.isFocused, placement: e.props.placement, state, hitAreas: e.surface === 'desktop',
    })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const theirs = await next(e)
    const state = await readBand($)
    const fx = fxOf($, e.surface)
    const tree = launcher({ el: $.ui.resolve(e) as unknown as El, state, theirs, open: () => { void game.actions(fx).open() } })
    game.launcherDrawn(fx, e.surface, !state.prefs.quiet)
    return tree
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const theirs = await next(e)
    const state = await readBand($)
    const fx = fxOf($, e.surface)
    const tree = launcher({ el: $.ui.resolve(e) as unknown as El, state, theirs, open: () => { void game.actions(fx).open() } })
    game.launcherDrawn(fx, e.surface, !state.prefs.quiet)
    return tree
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const battle = await read($, battleAtom)
    const prefs = await read($, prefsAtom)
    const suffix = spinnerSuffix(battle as GameState['battle'], e.props.suffix, e.props.mode, prefs.quiet)
    return suffix === null ? next(e) : next({ ...e, props: { ...e.props, suffix } })
  })
}

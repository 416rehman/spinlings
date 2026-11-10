// Claude Code's own auto-update for this mod (SPEC 32): where its plugin registry sits beside an installed copy, the
// one flag read from it, whether Claude Code's update pass can run at all, and when the band may offer to turn it on.
// The registry is never sent; client/autoswitch.ts is the only code that writes it, and only on a press. Any layout
// but an installed copy's (a dev folder, --plugin-dir) is never opened at all and reads as unknown. Pure.
import type { Account, AutoUpdate } from './types.ts'

const DAY = 86_400_000

/** The marketplace this mod installs from, as `.claude-plugin/marketplace.json` names it. */
export const MARKETPLACE = 'spinlings'
/** Step 1 of the guide: Claude Code's plugin manager. */
export const PLUGIN_COMMAND = '/plugin'
/** Puts the marketplace back when Claude Code's plugin list lost it (the switch's last resort). */
export const ADD_COMMAND = '/plugin marketplace add 416rehman/spinlings'
/** The same, run in a terminal: off the terminal /plugin cannot run (Claude Desktop opens its own page, the editors refuse it). */
export const ADD_SHELL_COMMAND = 'claude plugin marketplace add 416rehman/spinlings'
/** How often the guide reads the registry again while it is on screen, and for how long at most. */
export const WATCH_MS = 3000
export const WATCH_FOR_MS = 15 * 60_000

/** At most three offers ever; Not now waits a week; an offer left unanswered waits a day (another session, say). */
export const ASK = { max: 3, laterMs: 7 * DAY, unansweredMs: DAY } as const

const REGISTRY = 'known_marketplaces.json'
const VERSION_DIR = /^[\w.+-]{1,80}$/

/**
 * The registry of an installed copy, four levels up from its root: `<config>/plugins/cache/spinlings/spinlings/<version>`
 * reads `<config>/plugins/known_marketplaces.json`. Null for any other layout, so nothing else is ever opened.
 */
export function registryPath(root: unknown): string | null {
  if (typeof root !== 'string' || root.length === 0 || root.length > 1024) return null
  const trimmed = root.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  const n = parts.length
  if (n < 6 || parts.some(p => p === '..' || p === '.')) return null
  if (!VERSION_DIR.test(parts[n - 1]!) || parts[n - 2] !== MARKETPLACE || parts[n - 3] !== MARKETPLACE
    || parts[n - 4] !== 'cache' || parts[n - 5] !== 'plugins') return null
  // the separator just before `cache` joins the file to `<config>/plugins`
  let cut = trimmed.length
  for (let k = 0; k < 4; k++) cut = Math.max(trimmed.lastIndexOf('/', cut - 1), trimmed.lastIndexOf('\\', cut - 1))
  return `${trimmed.slice(0, cut)}${trimmed[cut]}${REGISTRY}`
}

/** The folder that holds the plugin list (`<config>/plugins`), for the guide to name; null for any other layout. */
export function registryFolder(root: unknown): string | null {
  const path = registryPath(root)
  return path === null ? null : path.slice(0, -REGISTRY.length - 1)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The spinlings entry's flag: true is on; no flag at all is off (the default for third-party marketplaces); false is
 * off by choice (/plugin, or a settings declaration Claude Code copies in at start). Any other value is unknown.
 */
export function autoUpdateOf(text: string | null | undefined): AutoUpdate {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) return 'unknown'
  let registry: unknown
  try {
    registry = JSON.parse(text)
  } catch {
    return 'unknown'
  }
  if (!isRecord(registry)) return 'unknown'
  const entry = registry[MARKETPLACE]
  if (!isRecord(entry)) return 'unknown'
  if (!Object.hasOwn(entry, 'autoUpdate')) return 'off'
  const flag = entry.autoUpdate
  return flag === true ? 'on' : flag === false ? 'off-chosen' : 'unknown'
}

/** The environment variables Claude Code's update pass reads, each only as set or not (never kept as text). */
export type UpdateEnv = {
  DISABLE_UPDATES?: string | undefined
  DISABLE_AUTOUPDATER?: string | undefined
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?: string | undefined
  FORCE_AUTOUPDATE_PLUGINS?: string | undefined
  CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST?: string | undefined
}

/**
 * Claude Code's auto-update is on for this mod and its update pass can run here, so a release arrives by itself the
 * next time Claude Code starts: no "is out" in the band, and the version chip and card say it is on its way.
 */
export const arrivesByItself = (a: Pick<Account, 'autoUpdate' | 'autoUpdateHeld'>): boolean => a.autoUpdate === 'on' && !a.autoUpdateHeld

/**
 * One press of the switch turns it on: off by default (never by choice), a plugin list it can write, and an update
 * pass that runs. Where it holds, /spin updates leads with Turn it on and the band's offer is a keyless press.
 */
export const oneTapOn = (a: Pick<Account, 'autoUpdate' | 'autoUpdateWritable' | 'autoUpdateHeld'>): boolean =>
  a.autoUpdate === 'off' && !!a.autoUpdateWritable && !a.autoUpdateHeld

/** Claude Code's own reading of a yes: 1, true, yes or on, in any case, trimmed. */
const yes = (v: string | undefined) => typeof v === 'string' && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

/**
 * Claude Code skips its plugin update pass, as 2.1.319 decides it: never with FORCE_AUTOUPDATE_PLUGINS; always with
 * DISABLE_UPDATES or any CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; with DISABLE_AUTOUPDATER only when no host app
 * runs Claude Code (a host such as the desktop app sets it for Claude Code's own updates, and plugins still update).
 */
export function updatesHeldBy(env: UpdateEnv): boolean {
  if (yes(env.FORCE_AUTOUPDATE_PLUGINS)) return false
  if (yes(env.DISABLE_UPDATES)) return true
  if (typeof env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === 'string' && env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== '') return true
  return !yes(env.CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST) && yes(env.DISABLE_AUTOUPDATER)
}

/** What the offer remembers on this machine ($.store): offers made, the earliest next one, and Don't ask again. */
export type AskRecord = { asks: number; until: number; never: boolean }

export function readAsk(v: unknown): AskRecord {
  const r: Record<string, unknown> = isRecord(v) ? v : {}
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
  return { asks: Math.min(ASK.max, Math.floor(num(r.asks))), until: num(r.until), never: r.never === true }
}

/**
 * The offer may show: never once on, nor once turned off on purpose (off-chosen), nor while Claude Code's update pass
 * is held on this computer (/plugin then hides its own toggle too), after Don't ask again or an explicit Turn it off
 * (both set `never`), after three offers, or while it waits.
 */
export function mayAsk(state: AutoUpdate | undefined, newer: boolean, ask: AskRecord, now: number, held = false): boolean {
  if (held || ask.never || ask.asks >= ASK.max || now < ask.until) return false
  return state === 'off' || (state === 'unknown' && newer)
}

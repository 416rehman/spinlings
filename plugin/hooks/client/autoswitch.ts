// The one-press switch for Claude Code's auto-update of this mod (SPEC 32): Turn it on sets `"autoUpdate": true` on
// the spinlings entry of Claude Code's plugin list (known_marketplaces.json); Turn it off takes exactly that key away
// again, and only when this switch put it there. Nothing else in the file changes, and it is written in the form
// Claude Code writes it itself (JSON.stringify(list, null, 2)). Pure: register.tsx lends the file through
// RegistryFile, at the one path client/autoupdate.ts derives, which never passes through here.
//
// The file's text stays inside one press. Another marketplace's source may carry a token in its git URL, so the text is
// never kept, logged, shown, thrown or sent; a failure keeps only its OS code, and every answer is a code.
import { MARKETPLACE } from './autoupdate.ts'
import { KEYS } from './store.ts'

export type SwitchTo = 'on' | 'off'
export type SwitchWhy = 'held' | 'busy' | 'cannot' | 'broken' | 'not-ours'
/** `wrote`: the file changed (false when it already said so). Never a message, never file text. */
export type SwitchAnswer = { ok: true; wrote: boolean } | { ok: false; why: SwitchWhy }

/** Claude Code's plugin list as register.tsx lends it: the path is fixed there, never named here. */
export type RegistryFile = {
  /** the path itself (`isLink` when it is a symbolic link); null when it cannot be read */
  stat(): Promise<{ kind: 'file' | 'dir' | 'other'; size: number; isLink: boolean } | null>
  /** Claude Code's lock beside it, `<path>.lock` (proper-lockfile's folder): its mtime, or null when there is none */
  lock(): Promise<{ mtimeMs: number } | null>
  /** the file's bytes as base64; rejects when it cannot */
  read(): Promise<string>
  /** the whole new text; rejects with the OS code when it cannot (not atomic: it truncates, then writes) */
  write(text: string): Promise<void>
}

export type SwitchIo = {
  file: RegistryFile
  /** the plugin store, for this switch's own record (KEYS.autoSwitch) and a Turn it on under way (KEYS.autoSwitchPending) */
  store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> }
  /** Claude Code's update pass cannot run here (client/autoupdate.ts updatesHeldBy) */
  held(): Promise<boolean>
  now(): Promise<number>
  wait(ms: number): Promise<void>
}

/**
 * What this switch remembers: that it turned auto-update on (KEYS.autoSwitch), and, under a key of its own, that a
 * Turn it on is under way (KEYS.autoSwitchPending, with `pending`). Either one is trusted only while the list says on.
 */
export type SwitchRecord = { v: 1; on: true; pending?: true }

/** Claude Code's plugin list is a few kilobytes; anything past this is not one the switch will rewrite. */
export const CAP = 1 << 20
/** The wait between looks at a lock or a busy file. */
export const STEP_MS = 250
/** How long a held lock is waited out before the answer is busy. */
export const LOCK_WAIT_MS = 2000
/**
 * A lock untouched this long belongs to a Claude Code that stopped: proper-lockfile refreshes a held lock's mtime every
 * 5 s and Claude Code itself takes over one 10 s old (its default `stale`); this waits three times that.
 */
export const LOCK_STALE_MS = 30_000
/** Looks at a list that will not read back, and writes of the old text over one our write broke (250 ms to 2 s apart). */
export const TRIES = 5

const BUSY: SwitchAnswer = { ok: false, why: 'busy' }
const CANNOT: SwitchAnswer = { ok: false, why: 'cannot' }
const MINE: SwitchRecord = { v: 1, on: true }
const PENDING: SwitchRecord = { v: 1, on: true, pending: true }
/** The base64 length of a list at the size cap: anything longer was not written by this switch. */
const CAP_B64 = Math.ceil(CAP / 3) * 4

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Obj = Record<string, Json>
/** What a press would write: the bytes it read (as base64 and as text) and the text it would put in their place. */
type Plan = { b64: string; before: string; after: string }

const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The record as this switch wrote it, or null for anything else. */
export function readRecord(v: unknown): SwitchRecord | null {
  return isRecord(v) && v.v === 1 && v.on === true ? { v: 1, on: true, ...(v.pending === true ? { pending: true as const } : {}) } : null
}

/** A failure's OS code (`EBUSY`), and nothing else about it. */
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && /^E[A-Z]{1,15}$/.test(code) ? code : ''
}

/** Strict UTF-8 (a byte-order mark is kept, so it fails to parse and nothing is rewritten): null when not text. */
function decode(b64: string): string | null {
  try {
    const raw = atob(b64)
    if (raw.length > CAP) return null
    const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function parse(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

/** The same JSON value, key order aside. */
function same(a: Json, b: Json): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]!))
  }
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k]!, b[k]!))
}

/** The spinlings entry's flag says `to`: true for on, no key at all for off. */
function says(entry: Obj, to: SwitchTo): boolean {
  return to === 'on' ? entry.autoUpdate === true : !Object.hasOwn(entry, 'autoUpdate')
}

/**
 * `after` is `before` with exactly the one change: the spinlings entry's autoUpdate is true (on) or gone (off), and
 * every other key, entry and value is as it was. Within the size cap.
 */
export function checkEdit(before: string, after: string, to: SwitchTo): boolean {
  if (new TextEncoder().encode(after).length > CAP) return false
  const a = parse(after), b = parse(before)
  if (!isRecord(a) || !isRecord(b)) return false
  const ae = a[MARKETPLACE], be = b[MARKETPLACE]
  if (!isRecord(ae) || !isRecord(be) || !says(ae, to)) return false
  // put the one key back as it was: what remains must be exactly what was there
  if (Object.hasOwn(be, 'autoUpdate')) ae.autoUpdate = be.autoUpdate!
  else delete ae.autoUpdate
  return same(a, b)
}

/** The text to write: Claude Code's own form, keeping the file's trailing newline if it had one. */
export function edited(before: string, to: SwitchTo): string | null {
  const next = parse(before)
  if (!isRecord(next)) return null
  const entry = next[MARKETPLACE]
  if (!isRecord(entry)) return null
  if (to === 'on') entry.autoUpdate = true
  else delete entry.autoUpdate
  return JSON.stringify(next, null, 2) + (before.endsWith('\n') ? '\n' : '')
}

async function quiet<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

const readB64 = (io: SwitchIo) => quiet<string | null>(() => io.file.read(), null)

/** Claude Code holds its lock right now (a stale one aside). */
async function locked(io: SwitchIo): Promise<boolean> {
  const lock = await quiet(() => io.file.lock(), null)
  if (!lock) return false
  const now = await quiet(() => io.now(), Number.NaN)
  return !(Number.isFinite(lock.mtimeMs) && Number.isFinite(now) && now - lock.mtimeMs > LOCK_STALE_MS)
}

/** Claude Code is not saving the list right now: no lock, a stale one, or one that clears within about 2 s. */
async function unlocked(io: SwitchIo): Promise<boolean> {
  for (let waited = 0; ; waited += STEP_MS) {
    if (!await locked(io)) return true
    if (waited >= LOCK_WAIT_MS) return false
    await io.wait(STEP_MS)
  }
}

/** Reads the list and works out the change; an answer instead when there is nothing to write or it cannot be done. */
async function plan(io: SwitchIo, to: SwitchTo, ours: boolean): Promise<Plan | SwitchAnswer> {
  const stat = await quiet(() => io.file.stat(), null)
  if (!stat || stat.kind !== 'file' || stat.isLink || !(stat.size <= CAP)) return CANNOT
  if (!await unlocked(io)) return BUSY
  const b64 = await readB64(io)
  const before = b64 === null ? null : decode(b64)
  if (b64 === null || before === null) return CANNOT
  const list = parse(before)
  const entry = isRecord(list) ? list[MARKETPLACE] : undefined
  if (!isRecord(entry)) return CANNOT
  if (says(entry, to) || (to === 'off' && entry.autoUpdate === false)) return { ok: true, wrote: false }
  // on only from the default (no key): a false is someone's choice, made in /plugin or in settings
  if (to === 'on' && Object.hasOwn(entry, 'autoUpdate')) return CANNOT
  if (to === 'off' && entry.autoUpdate !== true) return CANNOT
  if (to === 'off' && !ours) return { ok: false, why: 'not-ours' }
  const after = edited(before, to)
  if (after === null || !checkEdit(before, after, to)) return CANNOT
  return { b64, before, after }
}

/**
 * Writes, once more after a short wait when Windows says the file is busy (EBUSY, or EPERM while Claude Code renames
 * its own write into place). How it went is read back from the file, not from here.
 */
async function write(io: SwitchIo, text: string): Promise<void> {
  for (let tries = 0; tries < 2; tries++) {
    try {
      await io.file.write(text)
      return
    } catch (e) {
      const code = codeOf(e)
      if (code !== 'EBUSY' && code !== 'EPERM') return
    }
    if (tries === 0) await io.wait(STEP_MS)
  }
}

/** What the file says now: its bytes, or null when it still cannot be read after a few looks, each wait twice the last. */
async function readBack(io: SwitchIo): Promise<string | null> {
  for (let tries = 1; ; tries++) {
    const now = await readB64(io)
    if (now !== null || tries >= TRIES) return now
    await io.wait(STEP_MS * 2 ** (tries - 1))
  }
}

/** The list reads whole: it decodes and parses (or is past the cap, so someone else wrote it). */
function whole(b64: string | null): boolean {
  if (b64 === null) return false
  if (b64.length > CAP_B64) return true
  const text = decode(b64)
  return text !== null && text.trim() !== '' && parse(text) !== undefined
}

/** How a put-back ended: the old text is back, someone wrote a whole list, it never took, or Claude Code kept saving. */
type PutBack = 'put' | 'whole' | 'broken' | 'busy'

/**
 * Our truncating write left the list blank or cut short, and Claude Code cannot read a list it cannot parse: writes
 * back exactly what was there until it reads back whole, each wait twice the last. Never over a save of Claude Code's:
 * its writer falls back to writing in place when its rename fails, so while its lock is held it is waited out first,
 * and a list it left whole is no longer ours to put back.
 */
async function putBack(io: SwitchIo, p: Plan): Promise<PutBack> {
  for (let tries = 1; ; tries++) {
    if (await locked(io)) {
      if (!await unlocked(io)) return 'busy'
      if (whole(await readB64(io))) return 'whole'
    }
    await write(io, p.before)
    const back = await readB64(io)
    if (back === p.b64) return 'put'
    if (whole(back)) return 'whole'
    if (tries >= TRIES) return 'broken'
    await io.wait(STEP_MS * 2 ** (tries - 1))
  }
}

type Landed = 'ours' | 'untouched' | 'dropped' | 'broken' | 'unread'

/** How the write landed, from what the file says now. */
function landed(now: string | null, p: Plan, to: SwitchTo): Landed {
  if (now === null) return 'unread'
  if (now === p.b64) return 'untouched'
  // grown past the cap: someone else wrote it, so it is not ours to put back
  if (now.length > CAP_B64) return 'dropped'
  const text = decode(now)
  if (text === p.after) return 'ours'
  const list = text === null || text.trim() === '' ? undefined : parse(text)
  if (list === undefined) return 'broken'
  // Claude Code wrote after us: it kept ours, or it wrote from a read made before ours
  const entry = isRecord(list) ? list[MARKETPLACE] : undefined
  return isRecord(entry) && says(entry, to) ? 'ours' : 'dropped'
}

/**
 * What the write left, judged only while Claude Code is not saving the list. A save that took its lock before the
 * write read the list before it and may yet write that back; one that takes it while the list is read back may be
 * writing in place, so a list cut short then is looked at again once it is done. `saving`: one was waited out. Null
 * when a save still holds the lock after about 2 s.
 */
async function judge(io: SwitchIo, p: Plan, to: SwitchTo): Promise<{ how: Landed; saving: boolean } | null> {
  let saving = false
  for (let looks = 1; ; looks++) {
    if (await locked(io)) {
      saving = true
      if (!await unlocked(io)) return null
    }
    const how = landed(await readBack(io), p, to)
    if (how !== 'broken' || looks >= TRIES || !await locked(io)) return { how, saving }
  }
}

/**
 * One press: Turn it on, or Turn it off. Reads the list fresh (nothing from before the press is trusted), waits out
 * Claude Code's lock, writes only when the list still reads as it did, reads it back once Claude Code is not saving
 * it, and puts it back as it was if the write broke it. Never rejects.
 */
export async function press(io: SwitchIo, to: SwitchTo): Promise<SwitchAnswer> {
  if (await quiet(() => io.held(), false)) return { ok: false, why: 'held' }
  const set = (key: string, value: SwitchRecord) => quiet(() => io.store.set(key, value), undefined)
  const drop = (key: string) => quiet(() => io.store.delete(key), undefined)
  const has = async (key: string) => readRecord(await quiet(() => io.store.get(key), undefined)) !== null
  // ours to turn off: the record, or a Turn it on that a reload cut short (each trusted only while the list says on)
  const ours = to === 'off' && (await has(KEYS.autoSwitch) || await has(KEYS.autoSwitchPending))
  // it is so now: on keeps the record and then lets the pending one go (so a reload between keeps one); off forgets both
  const done = async () => {
    if (to === 'on') await set(KEYS.autoSwitch, MINE)
    else await drop(KEYS.autoSwitch)
    await drop(KEYS.autoSwitchPending)
  }
  // `pended`: this press put the pending record down, so a press whose write did not land takes it away again; the
  // record itself is never touched by a press that did not land, so one session's press never erases another's
  let wrote = false, pended = false
  const unpend = () => (pended ? drop(KEYS.autoSwitchPending) : Promise.resolve(undefined))
  for (let round = 0; round < 2; round++) {
    const p = await plan(io, to, ours)
    if (!('after' in p)) {
      // already so: off forgets the records; on claims nothing (on by someone else is not ours), unless our own
      // earlier write in this press is what made it so
      if (p.ok && (to === 'off' || wrote)) await done()
      else await unpend()
      return p.ok ? { ok: true, wrote } : p
    }
    // a reload mid-press still finds that a Turn it on was under way; it goes down before the last look, so nothing
    // stands between that look and the write. Turn it off needs none: its record holds until the list says off
    if (to === 'on' && !pended) {
      await set(KEYS.autoSwitchPending, PENDING)
      pended = true
    }
    if (!await unlocked(io) || await readB64(io) !== p.b64) continue
    await write(io, p.after)
    wrote = true
    const seen = await judge(io, p, to)
    // still saving after about 2 s: it may have landed, so the pending record stays (trusted only while the list says on)
    if (!seen) return BUSY
    switch (seen.how) {
      case 'ours':
        await done()
        return { ok: true, wrote: true }
      case 'untouched':
        // Claude Code wrote back the list it read before ours: plan again
        if (seen.saving) continue
        await unpend()
        return CANNOT
      case 'unread':
        // it may have landed: the pending record stays, trusted only if the list turns out to say on
        return BUSY
      case 'dropped':
        continue
      case 'broken': {
        // Claude Code is not saving, so this is our truncating write: put back exactly what was there
        const back = await putBack(io, p)
        if (back === 'busy') return BUSY
        await unpend()
        return back === 'broken' ? { ok: false, why: 'broken' } : CANNOT
      }
    }
  }
  await unpend()
  return BUSY
}

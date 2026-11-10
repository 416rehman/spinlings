// The one-press auto-update switch (SPEC 32) over a fake plugin list: it writes only `"autoUpdate": true` on the
// spinlings entry (or takes exactly that key away again), in Claude Code's own form, waits out Claude Code's lock,
// writes only when the list still reads as planned, reads back, restores what its truncating write broke, and answers
// in codes. Another marketplace's git URL carries a token; it never reaches the record, an answer or an error.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CAP, LOCK_STALE_MS, LOCK_WAIT_MS, STEP_MS, TRIES, checkEdit, edited, press, readRecord } from '../../plugin/hooks/client/autoswitch.ts'
import type { RegistryFile, SwitchIo, SwitchTo } from '../../plugin/hooks/client/autoswitch.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import { CANARY, b64, cc, list } from '../plugin/registry.ts'

const T0 = Date.UTC(2026, 10, 8, 12)
const errno = (code: string) => Object.assign(new Error(`${code}: open ${CANARY}`), { code })
const OURS = { [KEYS.autoSwitch]: { v: 1, on: true } }

type Hooks = {
  /** after the nth read (1-based), before answering; may change the file */
  onRead?: (n: number, f: Fake) => void
  /** in place of a plain write; may throw */
  onWrite?: (text: string, n: number, f: Fake) => void
  /** the lock seen at the nth look (1-based) */
  lockAt?: (n: number, f: Fake) => { mtimeMs: number } | null
}

type Fake = {
  bytes: string
  stat?: { kind: 'file' | 'dir' | 'other'; size: number; isLink: boolean }
  reads: number
  writes: string[]
  locks: number
  waits: number[]
  now: number
  store: Map<string, unknown>
  held: boolean
  io: SwitchIo
  text(): string
}

function fake(text: string, hooks: Hooks = {}, store: Record<string, unknown> = {}): Fake {
  const f: Fake = {
    bytes: b64(text), reads: 0, writes: [], locks: 0, waits: [], now: T0,
    store: new Map(Object.entries(store)), held: false, io: undefined as never,
    text: () => Buffer.from(f.bytes, 'base64').toString('utf8'),
  }
  const file: RegistryFile = {
    stat: async () => f.stat ?? { kind: 'file', size: Buffer.from(f.bytes, 'base64').length, isLink: false },
    lock: async () => hooks.lockAt?.(++f.locks, f) ?? null,
    read: async () => {
      f.reads++
      hooks.onRead?.(f.reads, f)
      return f.bytes
    },
    write: async t => {
      f.writes.push(t)
      if (hooks.onWrite) hooks.onWrite(t, f.writes.length, f)
      else f.bytes = b64(t)
    },
  }
  f.io = {
    file,
    store: {
      get: async key => structuredClone(f.store.get(key)),
      set: async (key, value) => { f.store.set(key, structuredClone(value)) },
      delete: async key => { f.store.delete(key) },
    },
    held: async () => f.held,
    now: async () => f.now,
    wait: async ms => { f.waits.push(ms); f.now += ms },
  }
  return f
}

/** Nothing the switch kept or said carries another marketplace's token. */
function clean(f: Fake, ...more: unknown[]): void {
  for (const [key, value] of f.store) assert.doesNotMatch(JSON.stringify(value) ?? '', /CANARY/, key)
  for (const x of more) assert.doesNotMatch(JSON.stringify(x) ?? '', /CANARY/)
}

describe('the press', () => {
  it('turns it on from the default: one write, the key appended last in Claude Code\'s form, the record set', async () => {
    const f = fake(cc(list()))
    const answer = await press(f.io, 'on')
    assert.deepEqual(answer, { ok: true, wrote: true })
    assert.deepEqual(f.writes, [cc(list({ autoUpdate: true }))])
    assert.match(f.writes[0]!, /"lastUpdated": "2026-11-01T10:00:02\.000Z",\n {4}"autoUpdate": true\n {2}\}\n\}$/)
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
    clean(f, answer)
  })

  it('turns it off by taking exactly that key away: the bytes are the original\'s again', async () => {
    const original = cc(list())
    const f = fake(original)
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(await press(f.io, 'off'), { ok: true, wrote: true })
    assert.equal(f.text(), original)
    assert.equal(f.store.has(KEYS.autoSwitch), false)
    clean(f)
  })

  it('a second press writes nothing', async () => {
    const f = fake(cc(list()))
    await press(f.io, 'on')
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: false })
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
    await press(f.io, 'off')
    assert.deepEqual(await press(f.io, 'off'), { ok: true, wrote: false })
    assert.equal(f.writes.length, 2)
  })

  it('keeps the file\'s own trailing newline, and Claude Code\'s none', async () => {
    const f = fake(`${cc(list())}\n`)
    await press(f.io, 'on')
    assert.equal(f.writes[0], `${cc(list({ autoUpdate: true }))}\n`)
    assert.equal(edited(cc(list()), 'on'), cc(list({ autoUpdate: true })))
  })

  it('on by someone else is not ours: Turn it off answers not-ours and writes nothing; on again claims nothing', async () => {
    const f = fake(cc(list({ autoUpdate: true })))
    assert.deepEqual(await press(f.io, 'off'), { ok: false, why: 'not-ours' })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: false })
    assert.deepEqual(f.writes, [])
    assert.equal(f.store.has(KEYS.autoSwitch), false)
  })

  it('a false is someone\'s choice: on cannot override it, off finds it already off', async () => {
    const f = fake(cc(list({ autoUpdate: false })), {}, OURS)
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.deepEqual(await press(f.io, 'off'), { ok: true, wrote: false })
    assert.deepEqual(f.writes, [])
    assert.equal(f.store.has(KEYS.autoSwitch), false, 'off forgets the record')
  })

  it('held: answers at once, reads and writes nothing', async () => {
    const f = fake(cc(list()))
    f.held = true
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'held' })
    assert.equal(f.reads, 0)
    assert.deepEqual(f.writes, [])
  })

  it('cannot, untouched: a link, a folder, too big, missing, a BOM, not UTF-8, no entry, junk values, not a list', async () => {
    const cases: [string, (f: Fake) => void][] = [
      ['link', f => { f.stat = { kind: 'file', size: 10, isLink: true } }],
      ['folder', f => { f.stat = { kind: 'dir', size: 0, isLink: false } }],
      ['too big', f => { f.stat = { kind: 'file', size: CAP + 1, isLink: false } }],
      ['missing', f => { f.io.file.stat = async () => null }],
      ['unreadable', f => { f.io.file.read = async () => { throw errno('EACCES') } }],
      ['bom', f => { f.bytes = b64(`﻿${cc(list())}`) }],
      ['not utf-8', f => { f.bytes = Buffer.concat([Buffer.from(cc(list()).slice(0, -1)), Buffer.from([0xff, 0x7d])]).toString('base64') }],
      ['no entry', f => { f.bytes = b64(cc({ other: {} })) }],
      ['entry not an object', f => { f.bytes = b64(cc({ spinlings: [] })) }],
      ['junk flag', f => { f.bytes = b64(cc(list({ autoUpdate: 'true' }))) }],
      ['an array', f => { f.bytes = b64('[]') }],
      ['not json', f => { f.bytes = b64('{"spinlings":') }],
    ]
    for (const [name, set] of cases) {
      const f = fake(cc(list()))
      set(f)
      const before = f.bytes
      const answer = await press(f.io, 'on')
      assert.deepEqual(answer, { ok: false, why: 'cannot' }, name)
      assert.deepEqual(f.writes, [], name)
      assert.equal(f.bytes, before, name)
      clean(f, answer)
    }
  })

  it('waits out Claude Code\'s lock, then writes', async () => {
    const f = fake(cc(list()), { lockAt: n => (n <= 3 ? { mtimeMs: T0 } : null) })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(f.waits, [STEP_MS, STEP_MS, STEP_MS])
    assert.equal(f.writes.length, 1)
  })

  it('a lock that stays: busy after about 2 s, nothing written', async () => {
    const f = fake(cc(list()), { lockAt: (_n, f) => ({ mtimeMs: f.now }) })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'busy' })
    assert.equal(f.waits.reduce((a, b) => a + b, 0), LOCK_WAIT_MS)
    assert.deepEqual(f.writes, [])
    assert.equal(f.store.has(KEYS.autoSwitch), false)
  })

  it('a lock left by a Claude Code that stopped is stale and does not hold the switch', async () => {
    const f = fake(cc(list()), { lockAt: () => ({ mtimeMs: T0 - LOCK_STALE_MS - 1 }) })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(f.waits, [])
  })

  it('the list changed under us: plans again once and writes the change on the new text; changing every time is busy', async () => {
    const newer = list()
    newer['claude-plugins-official']!.lastUpdated = '2026-11-08T12:00:00.000Z'
    // the fresh look just before the write (read 2) finds Claude Code's refresh
    const once = fake(cc(list()), { onRead: (n, f) => { if (n === 2) f.bytes = b64(cc(newer)) } })
    assert.deepEqual(await press(once.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(once.writes, [cc({ ...newer, spinlings: { ...newer.spinlings, autoUpdate: true } })])
    let k = 0
    const always = fake(cc(list()), { onRead: (_n, f) => { const l = list(); l.private!.lastUpdated = `x${k++}`; f.bytes = b64(cc(l)) } })
    assert.deepEqual(await press(always.io, 'on'), { ok: false, why: 'busy' })
    assert.deepEqual(always.writes, [])
  })

  it('EBUSY on the write: one more try after a short wait', async () => {
    const f = fake(cc(list()), { onWrite: (t, n, f) => { if (n === 1) throw errno('EBUSY'); f.bytes = b64(t) } })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.equal(f.writes.length, 2)
    assert.ok(f.waits.includes(STEP_MS))
  })

  it('EACCES: the file is untouched, so cannot, with no retry and the record as it was', async () => {
    const original = cc(list())
    const f = fake(original, { onWrite: () => { throw errno('EACCES') } })
    const answer = await press(f.io, 'on')
    assert.deepEqual(answer, { ok: false, why: 'cannot' })
    assert.equal(f.writes.length, 1)
    assert.equal(f.text(), original)
    assert.equal(f.store.has(KEYS.autoSwitch), false)
    clean(f, answer)
  })

  it('a write that truncated and failed is put back exactly as it was; cannot', async () => {
    const original = cc(list())
    const f = fake(original, { onWrite: (t, n, f) => { if (n === 1) { f.bytes = b64(t.slice(0, 40)); throw errno('ENOSPC') } f.bytes = b64(t) } })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.deepEqual(f.writes.slice(1), [original])
    assert.equal(f.text(), original)
    assert.equal(f.store.has(KEYS.autoSwitch), false)
  })

  it('a blank file after the write is restored too', async () => {
    const original = cc(list())
    const f = fake(original, { onWrite: (t, n, f) => { f.bytes = n === 1 ? '' : b64(t) } })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.equal(f.text(), original)
  })

  it('when even the restore does not take: broken after every try, and the record is as it was', async () => {
    const f = fake(cc(list()), { onWrite: (t, _n, f) => { f.bytes = b64(t.slice(0, 10)); throw errno('EIO') } }, OURS)
    f.bytes = b64(cc(list({ autoUpdate: true })))
    const answer = await press(f.io, 'off')
    assert.deepEqual(answer, { ok: false, why: 'broken' })
    assert.equal(f.writes.length, 1 + TRIES, 'the old text was written back on each try')
    assert.deepEqual(f.waits.slice(-(TRIES - 1)), [STEP_MS, 2 * STEP_MS, 4 * STEP_MS, 8 * STEP_MS], 'each wait twice the last')
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
    clean(f, answer)
  })

  it('the file cannot be read back: busy, and the pending record waits on what the list says', async () => {
    const f = fake(cc(list()), { onRead: n => { if (n >= 3) throw errno('EBUSY') } })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'busy' })
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.store.get(KEYS.autoSwitchPending), { v: 1, on: true, pending: true })
    assert.deepEqual(readRecord(f.store.get(KEYS.autoSwitchPending)), { v: 1, on: true, pending: true })
    assert.equal(f.store.has(KEYS.autoSwitch), false, 'the record itself waits for a write that is known to have landed')
  })

  it('Claude Code wrote after us and kept ours: success', async () => {
    const refreshed = list({ autoUpdate: true })
    refreshed.spinlings!.lastUpdated = '2026-11-08T12:00:00.000Z'
    const f = fake(cc(list()), { onWrite: (_t, _n, f) => { f.bytes = b64(cc(refreshed)) } })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
  })

  it('Claude Code wrote after us from an older read and dropped ours: once more, then busy', async () => {
    const stale = list()
    stale.spinlings!.lastUpdated = '2026-11-08T12:00:00.000Z'
    const again = fake(cc(list()), { onWrite: (t, n, f) => { f.bytes = n === 1 ? b64(cc(stale)) : b64(t) } })
    assert.deepEqual(await press(again.io, 'on'), { ok: true, wrote: true })
    assert.equal(again.writes.length, 2)
    assert.equal(JSON.parse(again.text()).spinlings.lastUpdated, '2026-11-08T12:00:00.000Z', 'the second write builds on what Claude Code wrote')
    // each refresh stamps its own time, so no write of theirs reads as ours never landing
    const always = fake(cc(list()), { onWrite: (_t, n, f) => { const l = list(); l.spinlings!.lastUpdated = `2026-11-08T12:00:0${n}.000Z`; f.bytes = b64(cc(l)) } })
    assert.deepEqual(await press(always.io, 'on'), { ok: false, why: 'busy' })
    assert.equal(always.writes.length, 2)
    assert.equal(always.store.has(KEYS.autoSwitch), false, 'the record is put back')
  })

  it('the pending record goes down before the last look: a save of Claude Code\'s while it is written is seen, never overwritten', async () => {
    const theirs = list()
    theirs['claude-plugins-official']!.lastUpdated = '2026-11-08T12:00:00.000Z'
    const f = fake(cc(list()))
    const set = f.io.store.set
    // Claude Code refreshes another marketplace while the store write runs
    f.io.store.set = async (key, value) => {
      await set(key, value)
      if ((value as { pending?: boolean }).pending && f.writes.length === 0) f.bytes = b64(cc(theirs))
    }
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(f.writes, [cc({ ...theirs, spinlings: { ...theirs.spinlings, autoUpdate: true } })], 'only a plan made on their save is written')
    assert.equal(JSON.parse(f.text())['claude-plugins-official'].lastUpdated, '2026-11-08T12:00:00.000Z')
  })

  it('a round that ends without writing puts the pending record back', async () => {
    let k = 0
    const f = fake(cc(list()), { onRead: (n, f) => { if (n % 2 === 0) { const l = list({ autoUpdate: true }); l.private!.lastUpdated = `x${k++}`; f.bytes = b64(cc(l)) } } }, OURS)
    f.bytes = b64(cc(list({ autoUpdate: true })))
    assert.deepEqual(await press(f.io, 'off'), { ok: false, why: 'busy' })
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
  })

  it('a Claude Code save that held its lock across our write: once it clears, its list is read and a second round puts the flag on it', async () => {
    const stale = list()
    stale.spinlings!.lastUpdated = '2026-11-08T12:00:00.000Z'
    let wrote = 0
    // its lock appears with our write; while it is held the file says ours, and as it clears, it writes the list it read before
    const f = fake(cc(list()), {
      onWrite: (t, _n, f) => { wrote++; f.bytes = b64(t) },
      lockAt: (_n, f) => {
        if (wrote !== 1) return null
        if (f.waits.length < 2) return { mtimeMs: f.now }
        f.bytes = b64(cc(stale))
        wrote++
        return null
      },
    })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.equal(f.writes.length, 2, 'not taken as landed while Claude Code was still saving')
    const now = JSON.parse(f.text())
    assert.equal(now.spinlings.autoUpdate, true)
    assert.equal(now.spinlings.lastUpdated, '2026-11-08T12:00:00.000Z')
  })

  it('a save that holds its lock past about 2 s after our write: busy, and the pending record stays for the list to settle', async () => {
    let wrote = false
    const f = fake(cc(list()), { onWrite: (t, _n, f) => { wrote = true; f.bytes = b64(t) }, lockAt: (_n, f) => (wrote ? { mtimeMs: f.now } : null) })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'busy' })
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.store.get(KEYS.autoSwitchPending), { v: 1, on: true, pending: true })
  })

  it('a restore that fails once is tried again until the list is whole: cannot, never broken', async () => {
    const original = cc(list())
    const f = fake(original, {
      onWrite: (t, n, f) => {
        if (n === 1) { f.bytes = b64(t.slice(0, 40)); throw errno('ENOSPC') }
        if (n === 2) throw errno('EIO')
        f.bytes = b64(t)
      },
    })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.equal(f.text(), original)
    assert.deepEqual(f.writes.slice(1), [original, original])
  })

  it('a list that will not read back, then reads cut short, is put back as it was', async () => {
    const original = cc(list())
    const f = fake(original, {
      onWrite: (t, n, f) => { f.bytes = b64(n === 1 ? t.slice(0, 25) : t) },
      onRead: n => { if (n === 3 || n === 4) throw errno('EBUSY') },
    })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.equal(f.text(), original)
    assert.equal(f.store.has(KEYS.autoSwitch), false)
  })

  it('a stale lock seen after the write is no save: the write is judged at once', async () => {
    let wrote = false
    const f = fake(cc(list()), { onWrite: (t, _n, f) => { wrote = true; f.bytes = b64(t) }, lockAt: () => (wrote ? { mtimeMs: T0 - LOCK_STALE_MS - 1 } : null) })
    assert.deepEqual(await press(f.io, 'on'), { ok: true, wrote: true })
    assert.deepEqual(f.waits, [])
  })

  it('a reload mid-press finds the pending record before the write lands', async () => {
    let seen: unknown
    const f = fake(cc(list()), { onWrite: (t, _n, f) => { seen = structuredClone(f.store.get(KEYS.autoSwitchPending)); f.bytes = b64(t) } })
    await press(f.io, 'on')
    assert.deepEqual(seen, { v: 1, on: true, pending: true })
    assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true })
    assert.equal(f.store.has(KEYS.autoSwitchPending), false, 'a press that landed lets its pending record go')
  })

  it('two sessions pressing at once: the one that finds it already on lets only its own pending record go, and the record survives', async () => {
    const a = fake(cc(list()))
    // session B shares A's list and store; it planned on the old list, and A's whole press runs before B goes on
    let ran = false
    const b: SwitchIo = {
      ...a.io,
      store: {
        ...a.io.store,
        set: async (key, value) => {
          if (!ran) {
            ran = true
            assert.deepEqual(await press(a.io, 'on'), { ok: true, wrote: true })
          }
          await a.io.store.set(key, value)
        },
      },
    }
    assert.deepEqual(await press(b, 'on'), { ok: true, wrote: false })
    assert.equal(a.writes.length, 1)
    assert.equal(JSON.parse(a.text()).spinlings.autoUpdate, true)
    assert.deepEqual(a.store.get(KEYS.autoSwitch), { v: 1, on: true })
    assert.equal(a.store.has(KEYS.autoSwitchPending), false)
  })

  it('two sessions pressing at once, whenever the second starts: the list ends on and the record survives', async () => {
    const tick = () => new Promise<void>(done => setImmediate(done))
    // every call into the list or the store yields, so the two presses interleave call by call
    const slow = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => { await tick(); return fn(...args) }
    for (let delay = 0; delay < 40; delay++) {
      const f = fake(cc(list()))
      const session = (): SwitchIo => ({
        ...f.io,
        file: { stat: slow(f.io.file.stat), lock: slow(f.io.file.lock), read: slow(f.io.file.read), write: slow(f.io.file.write) },
        store: { get: slow(f.io.store.get), set: slow(f.io.store.set), delete: slow(f.io.store.delete) },
      })
      const later = async () => {
        for (let i = 0; i < delay; i++) await tick()
        return press(session(), 'on')
      }
      const answers = await Promise.all([press(session(), 'on'), later()])
      assert.ok(answers.every(x => x.ok) && answers.some(x => x.ok && x.wrote), `${delay}: ${JSON.stringify(answers)}`)
      assert.equal(JSON.parse(f.text()).spinlings.autoUpdate, true, `${delay}`)
      assert.deepEqual(f.store.get(KEYS.autoSwitch), { v: 1, on: true }, `${delay}`)
      assert.equal(f.store.has(KEYS.autoSwitchPending), false, `${delay}`)
    }
  })

  it('a save of Claude Code\'s that starts while a list cut short is read back: nothing is written while its lock is held', async () => {
    const theirs = list()
    theirs['claude-plugins-official']!.lastUpdated = '2026-11-08T12:00:00.000Z'
    for (const ends of ['left it cut short', 'wrote it whole', 'kept saving'] as const) {
      const original = cc(list())
      let looks = 0, cut = false, over = false
      const underLock: number[] = []
      const f = fake(original, {
        onWrite: (t, n, f) => {
          if (looks > 0) underLock.push(n)
          f.bytes = b64(n === 1 ? t.slice(0, 40) : t)
          if (n === 1) cut = true
        },
        // its lock appears as the list cut short is read back and holds for three looks (or for good), and its own
        // write lands as it lets go
        onRead: () => { if (cut && !over && looks === 0) looks = ends === 'kept saving' ? Number.POSITIVE_INFINITY : 3 },
        lockAt: (_n, f) => {
          if (looks === 0) return null
          if (--looks === 0) {
            over = true
            if (ends === 'wrote it whole') f.bytes = b64(cc(theirs))
          }
          return { mtimeMs: f.now }
        },
      })
      const answer = await press(f.io, 'on')
      assert.deepEqual(underLock, [], `${ends}: no write while Claude Code holds its lock`)
      if (ends === 'left it cut short') {
        assert.deepEqual(answer, { ok: false, why: 'cannot' }, ends)
        assert.equal(f.text(), original, ends)
        assert.equal(f.store.has(KEYS.autoSwitchPending), false, ends)
      } else if (ends === 'wrote it whole') {
        assert.deepEqual(answer, { ok: true, wrote: true }, ends)
        const now = JSON.parse(f.text())
        assert.equal(now.spinlings.autoUpdate, true, 'the flag goes onto the list Claude Code saved')
        assert.equal(now['claude-plugins-official'].lastUpdated, '2026-11-08T12:00:00.000Z')
      } else {
        assert.deepEqual(answer, { ok: false, why: 'busy' }, ends)
        assert.equal(f.writes.length, 1, ends)
        assert.deepEqual(f.store.get(KEYS.autoSwitchPending), { v: 1, on: true, pending: true }, `${ends}: the pending record waits on what the list says`)
      }
      clean(f, answer)
    }
  })

  it('a lock that appears before a put-back write is waited out, and a list it left whole is not written over', async () => {
    const theirs = list()
    theirs.private!.lastUpdated = '2026-11-08T12:00:00.000Z'
    let wrote = 0, looks = 0, saved = false
    const underLock: number[] = []
    const f = fake(cc(list()), {
      onWrite: (t, n, f) => {
        wrote = n
        if (looks > 0) underLock.push(n)
        f.bytes = b64(n === 1 ? t.slice(0, 40) : t)
      },
      // no lock while the cut list is judged; it appears as the put-back is about to write, and Claude Code's save
      // (from a read made before ours) lands as it lets go
      lockAt: (n, f) => {
        if (wrote !== 1 || saved) return null
        if (looks === 0 && n > 4) looks = 3
        if (looks === 0) return null
        if (--looks === 0) {
          saved = true
          f.bytes = b64(cc(theirs))
        }
        return { mtimeMs: f.now }
      },
    })
    assert.deepEqual(await press(f.io, 'on'), { ok: false, why: 'cannot' })
    assert.deepEqual(underLock, [])
    assert.equal(f.writes.length, 1, 'nothing written over the list Claude Code saved')
    assert.equal(JSON.parse(f.text()).private.lastUpdated, '2026-11-08T12:00:00.000Z')
  })

  it('never rejects, and keeps no message: an error carrying the token is reduced to nothing', async () => {
    const f = fake(cc(list()))
    f.io.file.stat = async () => { throw new Error(`stat ${CANARY}`) }
    const a = await press(f.io, 'on')
    const g = fake(cc(list()), { onWrite: () => { throw new Error(`write ${CANARY}`) } })
    const b = await press(g.io, 'on')
    const h = fake(cc(list()))
    h.io.held = async () => { throw new Error(CANARY) }
    h.io.store.get = async () => { throw new Error(CANARY) }
    const c = await press(h.io, 'on')
    assert.deepEqual([a, b, c], [{ ok: false, why: 'cannot' }, { ok: false, why: 'cannot' }, { ok: true, wrote: true }])
    clean(f, a, b, c)
    clean(g)
    clean(h)
  })
})

describe('checkEdit', () => {
  const before = cc(list())
  const on = cc(list({ autoUpdate: true }))
  it('takes exactly the one change, either way', () => {
    assert.equal(checkEdit(before, on, 'on'), true)
    assert.equal(checkEdit(on, before, 'off'), true)
    assert.equal(checkEdit(`${before}\n`, `${on}\n`, 'on'), true)
  })
  it('refuses anything more or less', () => {
    const touched = (f: (l: ReturnType<typeof list>) => void) => { const l = list({ autoUpdate: true }); f(l); return cc(l) }
    for (const [why, after, to] of [
      ['no change', before, 'on'],
      ['false is not on', cc(list({ autoUpdate: false })), 'on'],
      ['a string is not on', cc(list({ autoUpdate: 'true' })), 'on'],
      ['another entry changed', touched(l => { l.private!.lastUpdated = 'x' }), 'on'],
      ['another entry gone', touched(l => { delete l.private }), 'on'],
      ['a key added', touched(l => { l.spinlings!.extra = 1 }), 'on'],
      ['the source changed', touched(l => { l.spinlings!.source = { source: 'git', url: 'https://evil.example/x.git' } }), 'on'],
      ['not json', '{', 'on'],
      ['on, asked off', on, 'off'],
      ['over the cap', cc({ ...list({ autoUpdate: true }), pad: 'x'.repeat(CAP) }), 'on'],
    ] as [string, string, SwitchTo][]) assert.equal(checkEdit(before, after, to), false, why)
  })
  it('key order aside, nothing else may differ', () => {
    const l = list({ autoUpdate: true })
    const reordered = { spinlings: l.spinlings, private: l.private, 'claude-plugins-official': l['claude-plugins-official'] }
    assert.equal(checkEdit(before, cc(reordered), 'on'), true)
  })
})

describe('the record', () => {
  it('is only {v:1, on:true}, with pending while a press runs', () => {
    assert.deepEqual(readRecord({ v: 1, on: true }), { v: 1, on: true })
    assert.deepEqual(readRecord({ v: 1, on: true, pending: true, text: 'x' }), { v: 1, on: true, pending: true })
    for (const v of [undefined, null, {}, { v: 2, on: true }, { v: 1, on: 'yes' }, [1], 'on']) assert.equal(readRecord(v), null, JSON.stringify(v))
  })
})

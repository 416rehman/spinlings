// Offline isolation (SPEC 28, 32): a full offline session (the welcome packs, a wild encounter and its catch, a Rival
// duel), then the online world, then offline and online again. Offline sends nothing and never reads a server's keys;
// online never reads the offline save; and nothing RemoteBackend sends, in any URL, header or body, carries a value
// from the offline save: no card id, no DNA, no name, no count. Every body is one the strict request schemas accept.
// Naming a community server offline asks it nothing either: it is first asked once play goes online.
import { expect, mock, test } from 'claude-code/testing'
import type { ApiOp } from '../hooks/core/api.ts'
import { API_ROUTES } from '../hooks/core/api.ts'
import { cardName } from '../hooks/core/cards.ts'
import { parseRequest } from '../hooks/core/schemas.ts'
import { openSave } from '../hooks/client/local/save.ts'
import { NOW, ORIGIN } from './fixtures.ts'
import { BAND, RUN, SESSION, engine, settle } from './engine.ts'
import type { Engine, Request } from './engine.ts'

/** The operation a request is, from its method and path. */
function opOf(r: Request): ApiOp | null {
  const path = new URL(r.url).pathname
  for (const [op, route] of Object.entries(API_ROUTES) as [ApiOp, (typeof API_ROUTES)[ApiOp]][]) {
    const re = new RegExp('^' + route.path.replace(/:[A-Za-z]+/g, '[^/]+') + '$')
    if (route.method === r.method && re.test(path)) return op
  }
  return null
}

/** Every value of the offline save a request must never carry. */
function offlineValues(w: Engine): { strings: string[]; numbers: number[]; sparks: number } {
  const opened = openSave(w.store.get('offline:v1'))
  if (opened.kind !== 'ok') throw new Error(`the offline save is ${opened.kind}`)
  const s = opened.state
  const strings = new Set<string>()
  for (const c of s.cards) {
    strings.add(c.id)
    strings.add(cardName(c))
  }
  for (const p of s.packs) strings.add(p.id)
  return { strings: [...strings], numbers: s.cards.map(c => c.dna).filter(d => d >= 1000), sparks: s.sparks }
}

test('offline, /spin server for a community server sends nothing; the server is first asked once play goes online', { timeoutMs: 120_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  // offline from the start: the world a player chose with /spin world, as the store keeps it
  w.store.set('prefs', { world: 'offline' })
  const COMMUNITY = 'https://cards.example.org'
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN(`server ${COMMUNITY}`))
  await settle(clock)
  expect(w.requests).toEqual([])
  expect(w.logs.at(-1)).toBe('cards.example.org is a community server run by someone else. See the band to use it when you play online.')
  const band = await $.ui.mount(BAND(80))
  expect((await band.find({ key: `act-server:${COMMUNITY}` }))?.props.label).toBe('Use it online')
  await band.press({ key: `act-server:${COMMUNITY}` })
  await settle(clock)
  await band.unmount()
  for (let i = 0; i < 10; i++) await clock.advance(60_000)
  await settle(clock)
  expect(w.requests).toEqual([])
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(w.requests.length).toBeGreaterThan(0)
  expect(w.requests.every(r => r.url.startsWith(`${COMMUNITY}/v1/`))).toBe(true)
  expect(new URL(w.requests[0]!.url).pathname).toBe('/v1/version')
})

test('an offline session, then online: nothing from the offline save reaches the server, and neither world reads the other\'s keys', { timeoutMs: 300_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  // offline from the start: the world a player chose with /spin world, as the store keeps it
  w.store.set('prefs', { world: 'offline' })
  const status = () => w.status.at(-1) ?? ''
  const until = async (done: () => boolean, seconds = 150) => {
    for (let i = 0; i < seconds && !done(); i++) await clock.advance(1000)
    await settle(clock)
  }

  // ---------- offline: the welcome, both packs, a wild encounter and its catch, a Rival duel ----------
  await $.session.start(SESSION)
  await settle(clock)
  expect(status()).toBe('spinlings · Offline · 2 packs')
  await $.command.run(RUN('pack'))
  await until(() => false, 20)
  await $.command.run(RUN('pack'))
  await until(() => false, 20)
  expect(status()).toBe('spinlings · Offline')
  await $.turn.start({ text: 'x', turnId: 't1' } as never)
  await until(() => /wild/.test(status()), 30)
  expect(status()).toMatch(/^spinlings · wild /)
  await until(() => !/wild/.test(status()))
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 90_000, isAborted: false, reason: 'answer' } as never)
  await until(() => false, 30)
  await clock.advance(3 * 60_000)
  await $.command.run(RUN('battle'))
  await settle(clock)
  expect(status()).toMatch(/^spinlings · vs Rival /)
  await until(() => !/ vs /.test(status()))
  await until(() => false, 30)
  expect(w.requests).toEqual([])
  expect(w.reads.filter(k => k.startsWith('server:'))).toEqual([])
  const offline = offlineValues(w)
  expect(offline.strings.length).toBeGreaterThan(12)
  const saved = JSON.stringify(w.store.get('offline:v1'))

  // ---------- online: a fresh account, its welcome pack, a duel ----------
  const readsBefore = w.reads.length
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(status()).toBe('spinlings · Online · 2 packs')
  await $.command.run(RUN('pack'))
  await until(() => false, 20)
  await clock.advance(3 * 60_000)
  await $.command.run(RUN('battle'))
  await settle(clock)
  await until(() => w.requests.some(r => r.url.endsWith('/finish')))
  await until(() => false, 15)
  const onlineReads = w.reads.slice(readsBefore)
  expect(onlineReads.filter(k => k.startsWith('offline:'))).toEqual([])
  expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)

  // ---------- and back: offline reads none of the server's keys, online resumes its session ----------
  let mark = w.reads.length
  const sentBefore = w.requests.length
  await $.command.run(RUN('world offline'))
  await settle(clock)
  await until(() => false, 30)
  expect(w.requests.length).toBe(sentBefore)
  expect(w.reads.slice(mark).filter(k => k.startsWith('server:'))).toEqual([])
  mark = w.reads.length
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(w.reads.slice(mark).filter(k => k.startsWith('offline:'))).toEqual([])
  expect(w.requests.filter(r => r.url.endsWith('/v1/join')).length).toBe(1)

  // ---------- what was sent ----------
  expect(w.requests.length).toBeGreaterThan(5)
  for (const r of w.requests) {
    expect(r.url.startsWith(`${ORIGIN}/v1/`)).toBe(true)
    const op = opOf(r)
    expect({ url: r.url, op: op !== null }).toEqual({ url: r.url, op: true })
    // the strict request schema the server uses: unknown fields are refused, so no count rides along
    if (r.body !== '') expect(() => parseRequest(op!, JSON.parse(r.body))).not.toThrow()
    const wire = [r.url, JSON.stringify(r.headers), r.body].join('\n')
    for (const v of offline.strings) expect({ url: r.url, carries: wire.includes(v) ? v : null }).toEqual({ url: r.url, carries: null })
    for (const n of offline.numbers) expect({ url: r.url, carries: new RegExp(`\\b${n}\\b`).test(wire) ? n : null }).toEqual({ url: r.url, carries: null })
    expect(r.body).not.toMatch(/sparks|rating|battles|streak|dna|genes|stats/)
  }
  // the two worlds keep separate keys: the offline save and this server's session, cache and meta
  const keys = [...w.store.keys()]
  expect(keys).toContain('offline:v1')
  expect(keys).toContain(`server:${ORIGIN}:session`)
  expect(keys.filter(k => !k.startsWith('offline:') && !k.startsWith(`server:${ORIGIN}:`)).sort()).toEqual(['prefs', 'presence', 'privacy'])
})

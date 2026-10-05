// The reveal ceremonies (SPEC 13.5, 13.9, 13.10, 14): the pack opens on o, flips on f, keeps the strip of glowing
// backs for older multi-card reveals, ends on a summary with Set in team and Done; single reveals hatch into the full card. The driver paces every
// beat from TIMING, blits same-size frames, gives up blitting where no Raster is (the desktop), respects motion off,
// stops when the reveal closes and follows a player who flips ahead.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Actions, El, Fx, GameState, Reveal, RevealControl, View } from '../hooks/client/types.ts'
import { INITIAL } from '../hooks/client/game.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import { TIMING } from '../hooks/client/anim.ts'
import { ceremony, holdMs } from '../hooks/ui/ceremony.tsx'
import {
  backOf, eggPixels, flipStage, packagePixels, presentPixels, singleMs, svgFace, svgPackage, svgSingle, svgTurn,
} from '../hooks/ui/ceremony-art.tsx'
import { pane } from '../hooks/ui/pane.tsx'
import { cardArt } from './engine.ts'

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const SURFACES = ['terminal', 'desktop'] as const

type Call = [string, unknown[]]
type Probe = { state: GameState; calls: Call[] }

function fakeActions(p: Probe): Actions {
  const setPane = (f: (x: GameState['pane']) => GameState['pane']) => { p.state = { ...p.state, pane: f(p.state.pane) } }
  const rec = (name: string, play?: (...a: never[]) => void) => async (...args: unknown[]) => { p.calls.push([name, args]); play?.(...(args as never[])) }
  const names = ['press', 'pickCatch', 'act', 'dismiss', 'open', 'close', 'back', 'hold', 'openPack', 'setForTrade', 'craft', 'buyPack',
    'duel', 'profile', 'load', 'offer', 'respond', 'counter', 'claim', 'redeem', 'wishlist', 'trade', 'world', 'connect', 'passkey',
    'rerollHandle', 'leaderboard', 'prefs'] as const
  return {
    ...(Object.fromEntries(names.map(n => [n, rec(n)])) as unknown as Actions),
    tab: rec('tab', (t: GameState['pane']['tab']) => setPane(x => ({ ...x, tab: t, stack: [] }))),
    push: rec('push', (v: View) => setPane(x => ({ ...x, stack: [...x.stack, v] }))),
    pane: rec('pane', (f: (x: GameState['pane']) => GameState['pane']) => setPane(f)),
    flip: rec('flip', () => { const r = p.state.reveal; if (r) setPane(x => ({ ...x, flipped: Math.min(r.cards.length, x.flipped + 1) })) }),
    doneReveal: rec('doneReveal', () => { p.state = { ...p.state, reveal: null }; setPane(x => ({ ...x, flipped: 0, stack: x.stack.filter(v => v.kind !== 'reveal') })) }),
    setTeam: rec('setTeam'), share: rec('share'), shareProfile: rec('shareProfile'),
  }
}

function draws(on: On, p: Probe): void {
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: fakeActions(p), focused: true, placement: 'inline', state: p.state,
  }))
}

const MOUNT = (columns: number, surface: (typeof SURFACES)[number]) => ({
  plugin: 'spinlings', surface, component: 'Pane', requestId: 'probe', viewport: { columns: columns + 4, rows: 40 },
  props: { title: 'Spinlings', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}) as const

type Ui = { press(t: { key: string; plugin?: string }): Promise<unknown>; redraw(): Promise<void> }
async function press(ui: Ui, key: string): Promise<void> {
  await ui.press({ key, plugin: 'test' })
  await ui.redraw()
}

const step = (title: string) => demoSteps(NOW).find(s => s.title === title)!.state
const historicalPack = (): Reveal => {
  const r = step('Pack · a gold back waiting').reveal!
  return { ...r, torn: false, cards: [step('Pack · sealed, waiting to tear').reveal!.cards[0]!, ...r.cards] }
}
const p: Probe = { state: INITIAL, calls: [] }

test('a sealed preview stays visible while waiting for Open, with either motion preference', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  draws(on, p)
  for (const motion of [true, false]) {
    const s = step('Pack · sealed, waiting to tear')
    p.state = { ...s, prefs: { ...s.prefs, motion }, reveal: { ...s.reveal!, cards: [], packId: 'waiting-pack' } }
    p.calls = []
    const ui = await $.ui.mount(MOUNT(80, 'desktop'))
    const before = cardArt(await ui.findAll({ type: 'Svg' }))
    expect(before.length).toBe(1)
    expect(before[0]!.props).toMatchObject({ alt: 'Opus pack', isInteractive: false })
    expect(String(before[0]!.props.source)).not.toMatch(/<animate|<set|visibility="hidden"/)
    await clock.advance(TIMING.tearDelay + TIMING.tear + 5000)
    await ui.redraw()
    expect(cardArt(await ui.findAll({ type: 'Svg' }))[0]!.props.source).toBe(before[0]!.props.source)
    expect(p.calls).toEqual([])
    expect((await ui.find({ key: 'flip' }))?.props.label).toBe('Open')
    await ui.unmount()
  }
})

test('the pack: o opens one card, then Set in team asks which slot without replacing anyone', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  for (const surface of SURFACES) {
    for (const columns of [50, 80, 120]) {
      p.state = step('Pack · sealed, waiting to tear')
      p.calls = []
      const art = surface === 'terminal' ? 'Raster' : 'Svg'
      const ui = await $.ui.mount(MOUNT(columns, surface))
      expect((await ui.find({ key: 'flip' }))?.props).toMatchObject({ label: 'Open', hotkey: 'o', variant: 'primary' })
      expect(await ui.find({ text: /Opus pack/ })).toBeDefined()
      expect(cardArt(await ui.findAll({ type: art })).length).toBe(1)
      // After the tear, the single back waits on the stage; there is no extra strip.
      p.state = { ...p.state, reveal: { ...p.state.reveal!, torn: true } }
      await ui.redraw()
      expect(cardArt(await ui.findAll({ type: art })).length).toBe(1)
      expect((await ui.find({ key: 'flip' }))?.props).toMatchObject({ label: 'Flip next', hotkey: 'f' })
      await press(ui, 'flip')
      expect(await ui.find({ key: 'flip' })).toBeUndefined()
      expect(cardArt(await ui.findAll({ type: art })).length).toBe(1)
      expect(await ui.find({ text: /NEW/ })).toBeDefined()
      expect(await ui.find({ text: /^1 card · 1 new species · Album 13\/36 \(\+1\)$/ })).toBeDefined()
      expect(await ui.find({ key: 'done' })).toBeDefined()
      const beforeTeam = [...p.state.me!.player.team]
      const beforeReveal = p.state.reveal!
      expect((await ui.find({ key: 'set-team' }))?.props.label).toBe('Set in team')
      await press(ui, 'set-team')
      expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'team-slot', cardId: beforeReveal.cards[0]!.id })
      expect(p.calls.map(c => c[0])).not.toContain('setTeam')
      expect(p.calls.map(c => c[0])).not.toContain('doneReveal')
      expect(p.state.me!.player.team).toEqual(beforeTeam)
      expect(p.state.reveal).toEqual(beforeReveal)
      expect(await ui.find({ key: 'team-slot-0' })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('a legendary turns the ceremony border gold', { timeoutMs: 30_000 }, async ($, on) => {
  draws(on, p)
  p.state = step('Pack · a legendary foil revealed')
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  const border = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(border?.props.borderColor).toBe('#f2b33d')
  await ui.unmount()
  p.state = step('Pack · a gold back waiting')
  const before = await $.ui.mount(MOUNT(80, 'terminal'))
  expect((await before.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.props.borderDimColor).toBe(true)
  expect(await before.find({ text: /backs glowing/ })).toBeUndefined()
  await before.unmount()
})

test('an egg hatches into the full card: nobody has ever seen it', { timeoutMs: 30_000 }, async ($, on) => {
  draws(on, p)
  for (const surface of SURFACES) {
    p.state = step('Fusion · the egg')
    const ui = await $.ui.mount(MOUNT(50, surface))
    expect((await ui.find({ key: 'flip' }))?.props).toMatchObject({ label: 'Open', hotkey: 'o', variant: 'primary' })
    expect(await ui.find({ text: /Two creatures become one/ })).toBeDefined()
    await press(ui, 'flip')
    expect(await ui.find({ text: /^Nobody has ever seen this creature\.$/ })).toBeDefined()
    expect(cardArt(await ui.findAll({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).length).toBe(1)
    if (surface === 'terminal') expect(await ui.find({ key: 'cer-card-art' })).toBeDefined()
    await press(ui, 'share')
    expect(p.calls.at(-1)?.[0]).toBe('share')
    await press(ui, 'done')
    expect(p.calls.at(-1)?.[0]).toBe('doneReveal')
    await ui.unmount()
  }
})

// ---------- the driver ----------

type Clock = { t: number; timers: { at: number; seq: number; fn: () => void }[]; seq: number }
type Blit = { key: string; length: number; at: number }

function fakeFx(clock: Clock, blits: Blit[], ok: (key: string) => boolean): Fx {
  const nope = async () => undefined
  return {
    now: async () => clock.t,
    random: () => 0.5,
    after: (ms, fn) => {
      const timer = { at: clock.t + Math.max(0, ms), seq: clock.seq++, fn }
      clock.timers.push(timer)
      return { cancel: () => { clock.timers = clock.timers.filter(x => x !== timer) } }
    },
    every: () => ({ cancel: () => undefined }),
    fetch: () => Promise.reject(new Error('no network in a ceremony')),
    store: { get: nope, set: nope, delete: nope, keys: async () => [] },
    state: { get: () => Promise.reject(new Error('unused')), update: () => Promise.reject(new Error('unused')) },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => false, openPane: async () => true, closePane: nope,
      blit: async (_site, key, cells) => { blits.push({ key, length: cells.length, at: clock.t }); return ok(key) },
      sound: () => undefined,
    },
  }
}

type Live = { reveal: Reveal | null; flipped: number; flips: [number, number][]; motion: boolean; tore?: number }

function control(live: Live, clock: Clock): RevealControl {
  return {
    reveal: async () => live.reveal,
    flipped: async () => live.flipped,
    flip: async n => { if (n > live.flipped) { live.flipped = n; live.flips.push([n, clock.t]) } },
    tear: async () => { if (live.reveal && !live.reveal.torn) { live.reveal = { ...live.reveal, torn: true }; live.tore = clock.t } },
    motion: async () => live.motion,
  }
}

/** The test kit has timers (a hooks module does not); a macrotask lets every awaited control call settle. */
declare const setTimeout: (fn: () => void, ms: number) => unknown
const flush = () => new Promise<void>(res => { setTimeout(res, 0) })

/** Runs the driver on the fake clock until it resolves; `each` may change the world between timers. */
async function run(clock: Clock, work: Promise<void>, each: () => void = () => undefined): Promise<void> {
  let done = false
  void work.then(() => { done = true })
  for (let i = 0; i < 20_000 && !done; i++) {
    await flush()
    if (done) break
    clock.timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
    const next = clock.timers.shift()
    if (!next) {
      await flush()
      if (!done) throw new Error('the driver is stuck with no timer pending')
      break
    }
    clock.t = next.at
    next.fn()
    each()
  }
  await work
}

const STAGE_CELLS = Math.ceil((18 * 10 * 12) / 3) * 4
const SLOT_CELLS = Math.ceil((8 * 4 * 12) / 3) * 4

test('the current pack driver tears, builds up, pauses and flips its one card before celebrating on the summary', { timeoutMs: 60_000 }, async () => {
  const r = step('Pack · sealed, waiting to tear').reveal!
  const clock: Clock = { t: 0, timers: [], seq: 0 }
  const blits: Blit[] = []
  const live: Live = { reveal: r, flipped: 0, flips: [], motion: true }
  await run(clock, ceremony(fakeFx(clock, blits, () => true), control(live, clock)))
  expect(live.flips.map(f => f[0])).toEqual([1])
  const first = r.cards[0]!
  expect(live.flips[0]![1]).toBeGreaterThanOrEqual(TIMING.tearDelay + TIMING.tear + TIMING.buildup[first.rarity] + TIMING.pause + TIMING.flip[first.rarity])
  const stage = blits.filter(b => b.key === 'cer-stage')
  expect(stage.length).toBeGreaterThan(20)
  expect(stage.every(b => b.length === STAGE_CELLS)).toBe(true)
  expect(blits.filter(b => b.key.startsWith('cer-slot-'))).toEqual([])
  expect(blits.some(b => b.key === 'sum-0-art' && b.at >= live.flips[0]![1])).toBe(true)
  const tear = stage.filter(b => b.at >= TIMING.tearDelay && b.at <= TIMING.tearDelay + TIMING.tear)
  expect(tear.length).toBeGreaterThan(2)
  expect(live.tore).toBeGreaterThanOrEqual(TIMING.tearDelay + TIMING.tear)
  expect(Math.max(...blits.map(b => b.at))).toBeLessThan(30_000)
})

test('an older pack leaves a refused key alone without stopping the others: the tear plays before the strip is out', { timeoutMs: 60_000 }, async () => {
  const r = historicalPack()
  const clock: Clock = { t: 0, timers: [], seq: 0 }
  const blits: Blit[] = []
  const live: Live = { reveal: r, flipped: 0, flips: [], motion: true }
  // only what is mounted takes a blit: the stage always, the strip once the pack is torn
  await run(clock, ceremony(fakeFx(clock, blits, key => key === 'cer-stage' || !!live.reveal?.torn), control(live, clock)))
  const tear = blits.filter(b => b.key === 'cer-stage' && b.at >= TIMING.tearDelay && b.at <= TIMING.tearDelay + TIMING.tear)
  expect(tear.length).toBeGreaterThan(2)
  expect(live.flips.map(f => f[0])).toEqual([1, 2])
  expect(blits.some(b => b.key === 'cer-slot-1' && b.at >= live.tore!)).toBe(true)
})

test('the driver stops blitting where there is no Raster, and still flips', { timeoutMs: 60_000 }, async () => {
  const r = step('Pack · sealed, waiting to tear').reveal!
  const clock: Clock = { t: 0, timers: [], seq: 0 }
  const blits: Blit[] = []
  const live: Live = { reveal: r, flipped: 0, flips: [], motion: true }
  await run(clock, ceremony(fakeFx(clock, blits, () => false), control(live, clock)))
  expect(live.flips.map(f => f[0])).toEqual([1])
  // Each key is tried at most eight times per state: sealed, torn and the one card turned.
  const keys = new Set(blits.map(b => b.key))
  expect([...keys].sort()).toEqual(['cer-stage', 'sum-0-art'])
  for (const k of keys) expect(blits.filter(b => b.key === k).length).toBeLessThanOrEqual(8 * 3)
})

test('motion off turns every card at once; a closed reveal stops the driver; flipping ahead is followed', { timeoutMs: 60_000 }, async () => {
  const r = step('Pack · sealed, waiting to tear').reveal!
  let clock: Clock = { t: 0, timers: [], seq: 0 }
  let live: Live = { reveal: r, flipped: 0, flips: [], motion: false }
  await run(clock, ceremony(fakeFx(clock, [], () => true), control(live, clock)))
  expect(live.flips).toEqual([[1, 0]])

  clock = { t: 0, timers: [], seq: 0 }
  live = { reveal: historicalPack(), flipped: 0, flips: [], motion: true }
  const l1 = live
  await run(clock, ceremony(fakeFx(clock, [], () => true), control(live, clock)), () => { if (l1.flipped >= 1) l1.reveal = null })
  expect(live.flips.map(f => f[0])).toEqual([1])

  clock = { t: 0, timers: [], seq: 0 }
  live = { reveal: historicalPack(), flipped: 0, flips: [], motion: true }
  const l2 = live
  let skipped = false
  await run(clock, ceremony(fakeFx(clock, [], () => true), control(live, clock)), () => {
    if (!skipped && clock.t > 200) { skipped = true; l2.flipped = 1 }
  })
  expect(live.flips.map(f => f[0])).toEqual([2])
})

test('an egg wobbles, cracks and hatches before it lands, then celebrates on the card', { timeoutMs: 60_000 }, async () => {
  const r = step('Fusion · the egg').reveal!
  const clock: Clock = { t: 0, timers: [], seq: 0 }
  const blits: Blit[] = []
  const live: Live = { reveal: r, flipped: 0, flips: [], motion: true }
  await run(clock, ceremony(fakeFx(clock, blits, () => true), control(live, clock)))
  expect(live.flips.map(f => f[0])).toEqual([1])
  expect(live.flips[0]![1]).toBeGreaterThanOrEqual(singleMs('egg', true))
  expect(new Set(blits.filter(b => b.key === 'cer-stage').map(b => b.at)).size).toBeGreaterThan(20)
  expect(blits.some(b => b.key === 'cer-card-art' && b.at >= live.flips[0]![1])).toBe(true)
  expect(blits.every(b => b.length === STAGE_CELLS)).toBe(true)
})

test('the art: 16x16 pieces, three tear frames, flip frames the stage\'s size, Svgs within bounds', () => {
  const r = step('Pack · sealed, waiting to tear').reveal!
  const legendary = step('Pack · a legendary foil revealed').reveal!.cards[0]!
  const square = (px: number[][], n: number) => px.length === n && px.every(row => row.length === n)
  expect(square(backOf(legendary, 16, 1), 16)).toBe(true)
  expect(square(backOf(r.cards[0]!, 8, 0), 8)).toBe(true)
  const frames = [0, 1, 2, 3].map(t => JSON.stringify(packagePixels('opus', t as 0 | 1 | 2 | 3)))
  expect(new Set(frames).size).toBe(4)
  expect(square(eggPixels(0x5b8def, 2, 1), 16)).toBe(true)
  expect(new Set([0, 1, 2].map(ph => JSON.stringify(presentPixels(ph as 0 | 1 | 2)))).size).toBe(3)
  for (const t of [0, 0.3, 0.5, 0.7, 1]) expect(flipStage(legendary, t)).toMatchObject({ columns: 18, rows: 10 })
  const svgs = [svgTurn(legendary, 8, true, { card: r.cards[0]!, hold: 600 }), svgTurn(legendary, 8, true), svgPackage('opus', 8, true), svgSingle('egg', step('Fusion · the egg').reveal!.cards[0]!, 8, true, true), svgSingle('present', legendary, 8, true, false)]
  for (const s of svgs) {
    expect(s.length).toBeLessThan(131_072)
    expect(s).toMatch(/<animate|<set /)
    expect(s).not.toContain('<script')
  }
  expect(svgFace(legendary, 8)).not.toContain('<animate')
  expect(svgTurn(legendary, 8, false, { card: r.cards[0]!, hold: 600 })).not.toContain('<animate')
  expect(svgPackage('opus', 8, false)).not.toContain('<set')
})

test('an older two-card reveal still holds the turned face before the next back builds up, pauses and flips', async () => {
  const r = historicalPack()
  const prev = r.cards[0]!, next = r.cards[1]!
  const hold = holdMs(prev, r)
  const svg = svgTurn(next, 8, true, { card: prev, hold })
  const sec = (ms: number) => `${(ms / 1000).toFixed(2)}s`
  // the back comes in as the face's hold ends, glowing (its border pulses) through the build-up
  expect(svg).toContain(`<set attributeName="visibility" to="visible" begin="${sec(hold)}" fill="freeze"/>`)
  expect(svg).toContain('attributeName="stroke-opacity"')
  // and squashes away only after the build-up and the pause
  expect(svg).toContain(`values="1 1;0.01 1" begin="${sec(hold + TIMING.buildup[next.rarity] + TIMING.pause)}"`)
  // the first card of a torn pack starts on its back
  const opening = svgTurn(r.cards[0]!, 8, true)
  expect(opening).toContain(`values="1 1;0.01 1" begin="${sec(TIMING.buildup[r.cards[0]!.rarity] + TIMING.pause)}"`)
  const clock: Clock = { t: 0, timers: [], seq: 0 }, blits: Blit[] = []
  const live: Live = { reveal: r, flipped: 0, flips: [], motion: true }
  await run(clock, ceremony(fakeFx(clock, blits, () => true), control(live, clock)))
  expect(live.flips.map(f => f[0])).toEqual([1, 2])
  expect(live.flips[1]![1] - live.flips[0]![1]).toBeGreaterThanOrEqual(hold + TIMING.buildup[next.rarity] + TIMING.pause + TIMING.flip[next.rarity])
  expect(blits.filter(b => b.key.startsWith('cer-slot-')).every(b => b.length === SLOT_CELLS)).toBe(true)
  expect(blits.some(b => b.key === 'cer-slot-1' && b.at < live.flips[1]![1])).toBe(true)
  expect(blits.some(b => b.key === 'sum-1-art' && b.at >= live.flips[1]![1])).toBe(true)
  expect(blits.some(b => b.key.startsWith('cer-slot-') && b.at < live.tore!)).toBe(false)
})

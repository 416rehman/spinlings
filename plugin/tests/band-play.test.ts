// The band's driver (client/scheduler.ts) against a clock the test moves: the rustle runs longer for rarer creatures,
// each round takes its pace, a press re-simulates the round on screen, frames stay at or under 24 a second, motion off
// and the desktop blit nothing, a server log is awaited before it plays, and the ceremonies after a battle change
// their words exactly when their beats end.
import { expect, test } from 'claude-code/testing'
import type { BattleLog, Card, Family, Rarity } from '../hooks/core/types.ts'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../hooks/core/battle.ts'
import { mintCard, toBattleCard } from '../hooks/core/cards.ts'
import { familySpecies, legendaryOf } from '../hooks/core/species.ts'
import { seasonOf } from '../hooks/core/world.ts'
import { TIMING } from '../hooks/client/anim.ts'
import { EVOLVE_SHOW, catchPreMs, noteLayout, revealHoldMs, roundPlan, rustleMs } from '../hooks/client/battleview.ts'
import { INITIAL, battleLog } from '../hooks/client/game.ts'
import { ceremonies, momentDriver, playBattle } from '../hooks/client/scheduler.ts'
import type { Battle, BattleControl, Fx, GameState, Moment, Outcome } from '../hooks/client/types.ts'

// The test runner has timers (a hooks module never does): a zero wait lets every pending continuation run.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const SEASON = seasonOf(NOW)
let serial = 0

function mint(family: Family, index: number, rarity: Rarity = 'common', shiny = false): Card {
  const species = index === 8 ? legendaryOf(SEASON, family) : familySpecies(SEASON, family).filter(s => !s.legendary)[index]!
  return { ...mintCard({ species, rarity, shiny, dna: 777 + serial, origin: 'pack', now: NOW, level: 3 }), id: `p-${++serial}` }
}
const team = [mint('opus', 0), mint('sonnet', 1), mint('haiku', 2)]

function battle(o: { kind?: 'wild' | 'duel'; defender?: Card[]; live?: boolean; phase?: Battle['phase'] } = {}): Battle {
  const kind = o.kind ?? 'wild'
  const defender = (o.defender ?? [mint('haiku', 3)]).map(toBattleCard)
  return {
    id: `play-${++serial}`, setup: { seed: `seed-${serial}`, kind, arena: 'opus', rule: 'calm', rules: RULES_VERSION, attacker: team.map(toBattleCard), defender },
    opponent: kind === 'duel' ? { kind: 'rival', name: 'Thistlewick', league: 'Pebble' } : { kind: 'wild' }, subs: [], firstPossible: defender.map(() => false),
    startedAt: NOW, finishAfter: NOW, live: o.live ?? true, phase: o.phase ?? 'rustle', shown: 0, inputs: [], log: null,
  }
}

type Blit = { at: number; key: string; cells: string }
type World = { fx: Fx; state: GameState; blits: Blit[]; sounds: string[]; now(): number; advance(ms: number): Promise<void>; sleep(ms: number): Promise<void> }

/** Effects over a clock in memory: waits resolve only as the test advances it; blits are recorded. */
function world(init: Partial<GameState> = {}): World {
  let now = NOW, seq = 0
  const timers: { at: number; seq: number; fn: () => void }[] = []
  const state = { ...INITIAL, prefs: { quiet: false, motion: true, sound: false }, ...init } as GameState
  const blits: Blit[] = []
  const sounds: string[] = []
  const fx: Fx = {
    now: async () => now,
    random: () => 0.5,
    after: (ms, fn) => {
      const t = { at: now + Math.max(0, ms), seq: seq++, fn }
      timers.push(t)
      return { cancel: () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } }
    },
    every: () => { throw new Error('the band never ticks on every') },
    fetch: () => Promise.reject(new Error('the band never fetches')),
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    state: {
      get: async k => state[k],
      update: async (k, fn) => { state[k] = fn(state[k]); return state[k] },
    },
    ui: {
      toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true, openPane: async () => true, closePane: async () => undefined,
      blit: async (_site, key, cells) => { blits.push({ at: now, key, cells }); return true },
      sound: cue => { sounds.push(cue) },
    },
  }
  const flush = () => new Promise<void>(r => setTimeout(r, 0))
  const w: World = {
    fx, state, blits, sounds, now: () => now,
    advance: async ms => {
      const end = now + ms
      for (;;) {
        await flush()
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
        const t = timers[0]
        if (!t || t.at > end) break
        timers.shift()
        now = Math.max(now, t.at)
        t.fn()
      }
      now = end
      await flush()
    },
    sleep: ms => new Promise<void>(r => { fx.after(ms, r) }),
  }
  return w
}

type Event = [number, string]

/** BattleControl as the game hands it over (client/game.ts drive), over the world's state; settle records the moment. */
function control(w: World, o: { serverMs?: number; onSettle?: (b: Battle) => void } = {}): { ctl: BattleControl; events: Event[] } {
  const events: Event[] = []
  const set = (fn: (b: Battle) => Battle) => { if (w.state.battle) w.state.battle = fn(w.state.battle) }
  const empty: BattleLog = { rounds: [], result: 'draw', maxHp: { a: [], d: [] }, fainted: { a: [], d: [] } }
  const ctl: BattleControl = {
    battle: async () => w.state.battle,
    log: async () => {
      const b = w.state.battle
      if (!b) return empty
      if (b.live) return battleLog(b)!
      if (!b.log) {
        await w.sleep(o.serverMs ?? 0)
        set(x => ({ ...x, log: simulateBattle(x.setup, []) }))
      }
      return (w.state.battle?.log ?? empty) as BattleLog
    },
    phase: async p => { events.push([w.now(), `phase:${p}`]); set(b => ({ ...b, phase: p })) },
    show: async n => { events.push([w.now(), `show:${n}`]); set(b => ({ ...b, shown: Math.max(b.shown, n) })) },
    paceMs: async () => 2200,
    settle: async () => {
      events.push([w.now(), 'settle'])
      const b = w.state.battle
      w.state.battle = null
      if (b) o.onSettle?.(b)
    },
  }
  return { ctl, events }
}

async function runUntil(w: World, done: () => boolean, maxMs = 180_000, step = 250): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += step) await w.advance(step)
}

const at = (events: Event[], name: string) => events.find(e => e[1] === name)?.[0]

/** At most `max` blits of one Raster in any one second. */
function busiest(blits: Blit[], key: string): number {
  const times = blits.filter(b => b.key === key).map(b => b.at)
  let best = 0
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i]! - times[j]! >= 1000) j++
    best = Math.max(best, i - j + 1)
  }
  return best
}

test('a wild battle: the rustle, the reveal, every round at its pace, then the settle', { timeoutMs: 120_000 }, async () => {
  noteLayout(100, 'terminal')
  const b = battle()
  const w = world({ battle: b })
  const { ctl, events } = control(w)
  const done = playBattle(w.fx, ctl)
  await runUntil(w, () => events.some(e => e[1] === 'settle'))
  await w.advance(500)
  await done
  const log = simulateBattle(b.setup, [])
  const reveal = at(events, 'phase:reveal')!, fight = at(events, 'phase:fight')!
  expect(reveal - NOW).toBeGreaterThanOrEqual(1500)
  expect(reveal - NOW).toBeLessThan(1500 + 60)
  expect(fight - reveal).toBeGreaterThanOrEqual(TIMING.reveal + revealHoldMs(b))
  expect(fight - reveal).toBeLessThan(TIMING.reveal + revealHoldMs(b) + 60)
  const shows = events.filter(e => e[1].startsWith('show:'))
  expect(shows.map(e => e[1])).toEqual(log.rounds.map(r => `show:${r.round}`))
  let last = fight
  for (const [t] of shows) {
    expect(t - last).toBeGreaterThanOrEqual(2200)
    last = t
  }
  expect(at(events, 'settle')!).toBeGreaterThanOrEqual(last)
  const lead = w.blits.filter(x => x.key === 'band-lead')
  expect(lead.length).toBeGreaterThan(10)
  expect(lead.every(x => x.at < fight + 60)).toBe(true)
  expect(w.blits.some(x => x.key === 'band-a') && w.blits.some(x => x.key === 'band-d')).toBe(true)
  for (const key of ['band-lead', 'band-a', 'band-d']) expect(busiest(w.blits, key)).toBeLessThanOrEqual(25)
})

test('rarer creatures rustle longer: 1.5 s common up to 3 s for the roamer and Mythics; a duel just calls', () => {
  expect(rustleMs(battle({ defender: [mint('haiku', 3)] }))).toBe(1500)
  expect(rustleMs(battle({ defender: [mint('haiku', 4, 'rare')] }))).toBe(2000)
  expect(rustleMs(battle({ defender: [mint('fable', 5, 'epic')] }))).toBe(2500)
  expect(rustleMs(battle({ defender: [mint('sonnet', 6, 'common', true)] }))).toBe(2000)
  expect(rustleMs(battle({ defender: [mint('fable', 8, 'legendary')] }))).toBe(3000)
  expect(rustleMs(battle({ kind: 'duel' }))).toBe(TIMING.duelIntro)
})

test('a press during the round its special fires plays that round Perfect, and nothing before it changes', { timeoutMs: 120_000 }, async () => {
  noteLayout(100, 'terminal')
  const base = battle({ kind: 'duel', defender: [mint('opus', 6), mint('fable', 1)] })
  const r = perfectRounds(simulateBattle(base.setup, []))[0]
  expect(r).toBeDefined()
  const play = async (press: boolean) => {
    const w = world({ battle: { ...base, id: `${base.id}-${press}` } })
    const { ctl, events } = control(w)
    const done = playBattle(w.fx, ctl)
    await runUntil(w, () => (w.state.battle?.shown ?? 0) >= r! - 1 && w.state.battle?.phase === 'fight', 120_000, 50)
    const start = w.now()
    if (press) w.state.battle = { ...w.state.battle!, inputs: [r!] }
    await runUntil(w, () => events.some(e => e[1] === `show:${r}`), 20_000, 50)
    const frames = w.blits.filter(x => x.key === 'band-d' && x.at >= start)
    w.state.battle = null
    await w.advance(1000)
    await done
    return { frames, before: w.blits.filter(x => x.key === 'band-d' && x.at < start).map(x => x.cells) }
  }
  const plain = await play(false)
  const pressed = await play(true)
  expect(pressed.before).toEqual(plain.before)
  expect(pressed.frames.at(-1)!.cells).not.toBe(plain.frames.at(-1)!.cells)
  const log = simulateBattle(base.setup, [r!])
  expect(log.rounds[r! - 1]!.actions.some(x => x.perfect)).toBe(true)
})

test('motion off and the desktop blit nothing, and keep the same beat', { timeoutMs: 120_000 }, async () => {
  const run = async (o: { motion: boolean; surface: string }) => {
    noteLayout(100, o.surface)
    const b = battle({ kind: 'duel' })
    const w = world({ battle: b, prefs: { quiet: false, motion: o.motion, sound: false } })
    const { ctl, events } = control(w)
    const done = playBattle(w.fx, ctl)
    await runUntil(w, () => events.some(e => e[1] === 'settle'))
    await done
    return { blits: w.blits.length, shows: events.filter(e => e[1].startsWith('show:')).length }
  }
  const moving = await run({ motion: true, surface: 'terminal' })
  const still = await run({ motion: false, surface: 'terminal' })
  const desk = await run({ motion: true, surface: 'desktop' })
  expect(moving.blits).toBeGreaterThan(0)
  expect(still.blits).toBe(0)
  expect(desk.blits).toBe(0)
  expect(still.shows).toBe(moving.shows)
  expect(desk.shows).toBe(moving.shows)
})

test('a battle whose rules differ waits for the server\'s log, then animates it', { timeoutMs: 120_000 }, async () => {
  noteLayout(100, 'terminal')
  const b = battle({ kind: 'duel', live: false })
  const w = world({ battle: b })
  const { ctl, events } = control(w, { serverMs: 6000 })
  const done = playBattle(w.fx, ctl)
  await runUntil(w, () => events.some(e => e[1] === 'settle'))
  await done
  const fight = at(events, 'phase:fight')!
  const first = events.find(e => e[1] === 'show:1')![0]
  expect(first - fight).toBeGreaterThanOrEqual(6000 + 2200)
  expect(events.filter(e => e[1].startsWith('show:')).length).toBe(simulateBattle(b.setup, []).rounds.length)
})

test('a battle that goes away mid-round stops the driver without a settle', { timeoutMs: 60_000 }, async () => {
  noteLayout(100, 'terminal')
  const w = world({ battle: battle({ phase: 'fight' }) })
  const { ctl, events } = control(w)
  const done = playBattle(w.fx, ctl)
  await w.advance(3000)
  w.state.battle = null
  await w.advance(1000)
  await done
  expect(events.some(e => e[1] === 'settle')).toBe(false)
})

function outcome(o: Partial<Outcome>): Outcome {
  return {
    battleId: 'x', kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(team[0]!), result: 'win', sparks: 10, rating: 1000, ratingDelta: 0,
    league: null, perfect: 0, xp: [], catch: { status: 'none' }, bounty: null, dailyWinPack: false, streak: 1, streakPack: false, ...o,
  }
}

test('the catch tells its result (and chimes) only when its beats are done; then the evolution has its own 3 s', { timeoutMs: 120_000 }, async () => {
  noteLayout(100, 'terminal')
  const b = battle({ phase: 'fight' })
  const caught = { ...mint('haiku', 4, 'rare'), id: 'caught' }
  const w = world({ battle: b, cards: [...team] })
  const id = `outcome:${b.id}`
  const evolveId = `evolve:${team[0]!.id}:2`
  const { ctl, events } = control(w, {
    onSettle: x => {
      w.state.moments = [
        { kind: 'outcome', id, outcome: outcome({ battleId: x.id, catch: { status: 'catching', options: [toBattleCard(caught)], index: 0 } }), until: null },
        { kind: 'evolve', id: evolveId, cardId: team[0]!.id, from: 'Little', to: 'Bigger', stage: 2, until: w.now() + 20_000 },
      ]
    },
  })
  const done = playBattle(w.fx, ctl)
  await runUntil(w, () => events.some(e => e[1] === 'settle'))
  await w.advance(300)
  // the server answers: caught
  const anchor = w.now()
  w.state.moments = w.state.moments.map(m => (m.id === id && m.kind === 'outcome' ? { ...m, outcome: { ...m.outcome, catch: { status: 'caught', card: caught } }, until: anchor + 12_000 } : m))
  const pre = catchPreMs(caught)
  await w.advance(pre - 100)
  expect(w.state.clock).toBeLessThan(anchor + pre)
  expect(w.sounds).toEqual([])
  await w.advance(200)
  expect(w.state.clock).toBeGreaterThanOrEqual(anchor + pre)
  expect(w.sounds).toEqual(['rare'])
  expect(w.blits.filter(x => x.key === 'band-art' && x.at >= anchor).length).toBeGreaterThan(10)
  // the result leaves; the evolution starts its ceremony then
  await w.advance(3000)
  w.state.moments = w.state.moments.filter(m => m.id !== id)
  await w.advance(400)
  const evolve = w.state.moments.find(m => m.id === evolveId) as Extract<Moment, { kind: 'evolve' }>
  const t0 = evolve.until! - EVOLVE_SHOW
  expect(Math.abs(t0 - (w.now() - 400))).toBeLessThanOrEqual(300)
  expect(w.sounds).toEqual(['rare', 'evolve'])
  expect(w.state.clock).toBeLessThan(t0 + TIMING.evolve)
  await w.advance(TIMING.evolve + 200 - (w.now() - t0))
  expect(w.state.clock).toBeGreaterThanOrEqual(t0 + TIMING.evolve)
  await w.advance(EVOLVE_SHOW)
  expect(w.state.moments.some(m => m.id === evolveId)).toBe(false)
  await done
})

test('a catch choice counts down once a second until one is picked', { timeoutMs: 60_000 }, async () => {
  noteLayout(100, 'terminal')
  const options = [mint('haiku', 3), mint('haiku', 4, 'rare')].map(toBattleCard)
  const w = world({})
  w.state.moments = [{ kind: 'outcome', id: 'outcome:c', outcome: outcome({ battleId: 'c', catch: { status: 'choose', options, deadline: NOW + 20_000 } }), until: NOW + 20_000 }]
  const done = ceremonies(w.fx, 'c')
  const clocks: number[] = []
  for (let i = 0; i < 5; i++) { await w.advance(1000); clocks.push(w.state.clock) }
  expect(new Set(clocks).size).toBe(5)
  w.state.moments = []
  await w.advance(2000)
  await done
})

test('a round plan lands a live special late enough to answer, and a knock-out has time to fall', () => {
  const b = { ...battle({ kind: 'duel', defender: [mint('opus', 6), mint('fable', 1)] }), phase: 'fight' as const }
  const log = simulateBattle(b.setup, [])
  for (let r = 1; r <= log.rounds.length; r++) {
    const plan = roundPlan(b, log, r, 2200)!
    const first = plan.hits[0]
    if (first?.actor === 'a' && first.action.move === 'special') expect(first.at).toBeGreaterThanOrEqual(1000)
    if (plan.hits.some(h => h.action.targetFainted)) expect(plan.ms).toBeGreaterThanOrEqual(plan.hits.at(-1)!.at + TIMING.ko)
    expect(plan.ms).toBeGreaterThanOrEqual(2200)
  }
})

test('the moment driver hatches the welcome once, glows a ready pack, and leaves the rest to their drivers', { timeoutMs: 60_000 }, async () => {
  noteLayout(80, 'terminal')
  const w = world({ cards: [...team] })
  w.state.moments = [{ kind: 'welcome', id: 'welcome', packId: null, until: null }]
  void momentDriver(w.fx)
  await w.advance(TIMING.hatch + TIMING.sparkle + 1000)
  const hatched = w.blits.length
  expect(hatched).toBeGreaterThan(4)
  expect(w.blits.every(b => b.key === 'band-art')).toBe(true)
  await w.advance(3000)
  expect(w.blits.length).toBe(hatched)
  w.state.moments = [{ kind: 'pack-ready', id: 'pack-ready', count: 1, until: NOW + 60_000 }]
  await w.advance(2000)
  expect(w.blits.length).toBeGreaterThan(hatched)
  const glowed = w.blits.length
  w.state.moments = [{ kind: 'update', id: 'update:9', version: '9.0.0', until: null }]
  await w.advance(7000)
  expect(w.blits.length - glowed).toBeLessThanOrEqual(25 * 1)
  const settled = w.blits.length
  await w.advance(3000)
  expect(w.blits.length).toBe(settled)
  w.state.prefs = { quiet: false, motion: false, sound: false }
  w.state.moments = [{ kind: 'present', id: 'present:x', from: 'quiet-otter-42', cardIds: [], until: null }]
  await w.advance(4000)
  expect(w.blits.length).toBe(settled)
})

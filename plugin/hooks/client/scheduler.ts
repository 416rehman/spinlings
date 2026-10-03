// How the band plays a battle and its ceremonies (SPEC 5, 13, 14): the battle driver for register.tsx's slot, from
// the rustle to the settle, then the catch's wobble beats, a Mythic's farewell and each evolution. On the terminal it
// blits the frames client/battleview.ts draws, at 24 a second; the desktop's Svg animates itself, so there it only
// keeps the beat. Text changes only at state transitions: the battle's phase and rounds through BattleControl, and a
// ceremony's stage through the clock, stamped at each boundary. When a creature finds you is client/session.ts's.
import type { BattleCard, BattleLog } from '../core/types.ts'
import { FRAME_MS, TIMING, pixelCells } from './anim.ts'
import type { EvolveMoment, OutcomeMoment, RoundPlan } from './battleview.ts'
import {
  EVOLVE_SHOW, KEYS, catchCard, catchFrame, catchPreMs, drawnLayout, drawCount, evolveFrame, fightCells,
  fledFrame, foreshadowOf, hatchFrame, leadCard, logOf, lookAt, outcomeAnchor, packFamily, packFrame, presentFrame,
  revealFrame, revealHoldMs, roundPlan, rustleFrame, rustleMs, spriteOf,
} from './battleview.ts'
import { chimeFor, headMoment } from './game.ts'
import type { Battle, BattleDriver, Fx, Moment } from './types.ts'

const sleep = (fx: Fx, ms: number) => new Promise<void>(r => { fx.after(Math.max(0, ms), r) })

async function motionOn(fx: Fx): Promise<boolean> {
  const p = await fx.state.get('prefs')
  return p.motion && !p.quiet
}

/** Moves the clock the band reads to now, so a ceremony's text changes stage on time. */
async function stamp(fx: Fx): Promise<number> {
  const now = await fx.now()
  await fx.state.update('clock', c => Math.max(c, now))
  return now
}

/** Moments a ceremony is playing, so two drivers never animate one at once. */
const playing = new Set<string>()

type Frame = Map<string, string>

/**
 * Plays an animation for `ms()` ms (re-read every frame: a press can lengthen a round). Each frame asks `step(t)`
 * whether the moment is still on, and `draw(t)` for the Rasters it shows; only changed cells are blitted, and every
 * cell again after the band redraws (a redraw puts back its resting frame). Off the terminal or with motion off it
 * only waits, checking a few times a second. False when `step` said the moment is gone.
 */
async function play(fx: Fx, ms: () => number, step: (t: number) => Promise<boolean>, draw: ((t: number) => Frame) | null): Promise<boolean> {
  const start = await fx.now()
  const motion = await motionOn(fx)
  const sent = new Map<string, string>()
  let drawn = drawCount()
  for (;;) {
    const t = (await fx.now()) - start
    if (t >= ms()) return true
    if (!(await step(t))) return false
    const blitting = motion && draw !== null && drawnLayout().surface === 'terminal'
    if (blitting) {
      if (drawCount() !== drawn) { sent.clear(); drawn = drawCount() }
      const frame = draw!(t)
      const changed = [...frame].filter(([k, c]) => sent.get(k) !== c)
      const ok = await Promise.all(changed.map(([k, c]) => fx.ui.blit('band', k, c)))
      changed.forEach(([k, c], i) => { if (ok[i]) sent.set(k, c); else sent.delete(k) })
    }
    await sleep(fx, Math.min(blitting ? FRAME_MS : 250, Math.max(1, ms() - t)))
  }
}

const one = (key: string, cells: string): Frame => new Map([[key, cells]])

// ---------- the battle ----------

/**
 * The battle driver (register.tsx's BATTLE_DRIVER): the rustle with its foreshadowing, the reveal's flash, every
 * round at the effort's pace with its hits, numbers, drains and knock-outs, then the settle and the ceremonies.
 * A live battle re-simulates on a press; one whose rules differ animates the server's log once it is in.
 */
export const playBattle: BattleDriver = async (fx, ctl) => {
  const first = await ctl.battle()
  if (!first) return
  const id = first.id
  const alive = async () => (await ctl.battle()) !== null
  const lead = first.setup.defender[0] ?? null
  if (first.phase === 'rustle') {
    const ms = rustleMs(first)
    const fore = foreshadowOf(lead)
    const px = lead ? spriteOf(lead, 'mini') : null
    const still = ms - TIMING.pause
    if (!(await play(fx, () => ms, alive, px ? t => one(KEYS.lead, pixelCells(rustleFrame(px, fore, Math.min(t, still), lead!.id)).cells) : null))) return
    await ctl.phase('reveal')
  }
  if ((await ctl.battle())?.phase === 'reveal') {
    const b = (await ctl.battle())!
    const px = lead ? spriteOf(lead, 'mini') : null
    const ms = TIMING.reveal + revealHoldMs(b)
    if (!(await play(fx, () => ms, alive, px ? t => one(KEYS.lead, pixelCells(revealFrame(px, lead, t, lead!.id)).cells) : null))) return
    await ctl.phase('fight')
  }
  if (!(await fight(fx, ctl))) return
  if (!(await ctl.battle())) return
  await ctl.settle()
  await ceremonies(fx, id)
}

async function fight(fx: Fx, ctl: Parameters<BattleDriver>[1]): Promise<boolean> {
  for (;;) {
    let b = await ctl.battle()
    if (!b) return false
    if (b.phase === 'finishing') return true
    const log = await ctl.log() as BattleLog
    b = await ctl.battle()
    if (!b) return false
    if (b.shown >= log.rounds.length) return true
    const r = b.shown + 1
    const pace = await ctl.paceMs()
    let plan: RoundPlan | null = roundPlan(b, log, r, pace)
    if (!plan) return true
    let inputs = b.inputs.join(',')
    const ok = await play(fx, () => plan!.ms, async () => {
      const cur: Battle | null = await ctl.battle()
      if (!cur) return false
      if (cur.inputs.join(',') !== inputs) {
        // a press re-simulates: the round plays on with the Perfect special's numbers
        inputs = cur.inputs.join(',')
        plan = roundPlan(cur, (logOf(cur) ?? log) as BattleLog, r, pace) ?? plan
      }
      return true
    }, t => fightCells(plan!.fighters, { a: lookAt(plan!, 'a', t), d: lookAt(plan!, 'd', t) }, drawnLayout().columns))
    if (!ok) return false
    await ctl.show(r)
  }
}

// ---------- ceremonies after a battle ----------

const belongs = (m: Moment, battleId: string, evolves: ReadonlySet<string>) =>
  (m.kind === 'outcome' && m.outcome.battleId === battleId) || (m.kind === 'evolve' && evolves.has(m.id))

/**
 * After the settle: the catch ceremony (or the choice's countdown), a Mythic's farewell, then each evolution, as each
 * reaches the head of the band's queue. Ends when this battle's moments are gone, a new battle starts, or after 90 s.
 */
export async function ceremonies(fx: Fx, battleId: string): Promise<void> {
  const until = (await fx.now()) + 90_000
  const evolves = new Set((await fx.state.get('moments')).filter(m => m.kind === 'evolve').map(m => m.id))
  const done = new Set<string>()
  while ((await fx.now()) < until) {
    if (await fx.state.get('battle')) return
    const moments = await fx.state.get('moments')
    if (!moments.some(m => belongs(m, battleId, evolves))) return
    const head = headMoment(moments)
    const key = head ? stageKey(head) : ''
    if (head && belongs(head, battleId, evolves) && !done.has(key) && !playing.has(head.id)) {
      playing.add(head.id)
      try {
        if (head.kind === 'outcome') await outcomeCeremony(fx, head)
        else if (head.kind === 'evolve') await evolveCeremony(fx, head)
      } finally {
        playing.delete(head.id)
      }
      done.add(key)
      continue
    }
    await sleep(fx, 250)
  }
}

const stageKey = (m: Moment) => (m.kind === 'outcome' ? `${m.id}|${m.outcome.catch.status}` : m.id)

async function current(fx: Fx, id: string): Promise<Moment | null> {
  return (await fx.state.get('moments')).find(m => m.id === id) ?? null
}

async function outcomeCeremony(fx: Fx, m: OutcomeMoment): Promise<void> {
  const c = m.outcome.catch
  if (c.status === 'choose') {
    // the countdown to the rarest pick ticks once a second until a choice is made
    for (;;) {
      const now = await current(fx, m.id)
      if (!now || now.kind !== 'outcome' || now.outcome.catch.status !== 'choose' || (await fx.state.get('battle'))) return
      await stamp(fx)
      await sleep(fx, 1000)
    }
  }
  const card = catchCard(m)
  // the chime comes with the result, never before the wobble beats end
  const gotcha = () => { const cue = c.status === 'caught' ? chimeFor([c.card]) : null; if (cue) fx.ui.sound(cue) }
  if (!(await motionOn(fx))) { gotcha(); return }
  if (c.status === 'catching' && card) {
    // the server has not answered yet: the card keeps wobbling
    const px = spriteOf(card, 'mini')
    await play(fx, () => 15_000, async () => {
      const now = await current(fx, m.id)
      return !!now && now.kind === 'outcome' && now.outcome.catch.status === 'catching'
    }, t => one(KEYS.art, pixelCells(catchFrame(px, card, t, 'pending')).cells))
    return
  }
  if ((c.status === 'caught' || c.status === 'slipped') && card) {
    const anchor = outcomeAnchor(m)
    if (anchor === null) return
    const px = spriteOf(card, 'mini')
    const result = c.status
    const pre = catchPreMs(card)
    const end = pre + 2 * TIMING.spinFrame + (result === 'caught' ? TIMING.sparkle : 900)
    let revealed = false
    await stamp(fx)
    const begin = await fx.now()
    const offset = Math.max(0, begin - anchor)
    await play(fx, () => end - offset, async t => {
      if (!revealed && t + offset >= pre) { revealed = true; gotcha(); await stamp(fx) }
      return !!(await current(fx, m.id))
    }, t => one(KEYS.art, pixelCells(catchFrame(px, card, t + offset, result)).cells))
    if (!revealed) { gotcha(); await stamp(fx) }
    return
  }
  if (c.status === 'fled' && m.outcome.lead) {
    const lead: BattleCard = m.outcome.lead
    const px = spriteOf(lead, 'mini')
    await play(fx, () => TIMING.fled, async () => !!(await current(fx, m.id)), t => one(KEYS.art, pixelCells(fledFrame(px, t, lead.id)).cells))
  }
}

async function evolveCeremony(fx: Fx, m: EvolveMoment): Promise<void> {
  fx.ui.sound('evolve')
  if (!(await motionOn(fx))) return
  const card = (await fx.state.get('cards')).find(x => x.id === m.cardId)
  const t0 = await fx.now()
  const leaves = t0 + EVOLVE_SHOW
  // the moment now starts with its ceremony: the band reads the start from its `until`
  await fx.state.update('moments', list => list.map(x => (x.id === m.id && x.kind === 'evolve' ? { ...x, until: leaves } : x)))
  await stamp(fx)
  const from = card ? spriteOf({ ...card, stage: Math.max(1, m.stage - 1) as 1 | 2 | 3 }, 'mini') : null
  const to = card ? spriteOf({ ...card, stage: m.stage }, 'mini') : null
  let revealed = false
  const still = async () => {
    const now = await current(fx, m.id)
    return !!now && now.kind === 'evolve' && now.until === leaves
  }
  const ok = await play(fx, () => TIMING.evolve + TIMING.evolveFlash + TIMING.sparkle, async t => {
    if (!revealed && t >= TIMING.evolve) { revealed = true; await stamp(fx) }
    return still()
  }, from && to ? t => one(KEYS.art, pixelCells(evolveFrame(from, to, t)).cells) : null)
  if (!revealed) await stamp(fx)
  if (!ok) return
  // it leaves on its own new time (the game's timer was set for the old one)
  await sleep(fx, Math.max(0, leaves - (await fx.now())))
  if (await still()) await fx.state.update('moments', list => list.filter(x => !(x.id === m.id && x.kind === 'evolve' && x.until === leaves)))
}

// ---------- the moments without a battle ----------

/**
 * The band's other moments on the terminal: the welcome's egg hatching, a ready pack's glow, a present's wobble.
 * A long-lived loop for a boot-time slot; the desktop needs none (its Svg animates itself), and without it these
 * moments simply hold their resting frame.
 */
export async function momentDriver(fx: Fx): Promise<void> {
  const shown = new Set<string>()
  for (;;) {
    if (await fx.state.get('battle')) { await sleep(fx, 1000); continue }
    const state = { me: await fx.state.get('me'), cards: await fx.state.get('cards'), signals: await fx.state.get('signals') }
    const head = headMoment(await fx.state.get('moments'))
    const mine = head && (head.kind === 'welcome' ? !shown.has(head.id) : head.kind === 'pack-ready' || head.kind === 'present')
    if (!head || !mine || playing.has(head.id) || !(await motionOn(fx)) || drawnLayout().surface !== 'terminal') { await sleep(fx, 500); continue }
    const id = head.id
    const on = async () => !(await fx.state.get('battle')) && headMoment(await fx.state.get('moments'))?.id === id
    playing.add(id)
    try {
      if (head.kind === 'welcome') {
        const lead = leadCard(state)
        const px = lead ? spriteOf(lead, 'mini') : null
        const family = lead?.family ?? state.signals.family
        await play(fx, () => TIMING.hatch + TIMING.sparkle, on, t => one(KEYS.art, pixelCells(hatchFrame(px, family, t)).cells))
        shown.add(id)
      } else if (head.kind === 'pack-ready') {
        const family = packFamily(state)
        await play(fx, () => 6000, on, t => one(KEYS.art, pixelCells(packFrame(family, t)).cells))
      } else {
        await play(fx, () => 3200, on, t => one(KEYS.art, pixelCells(presentFrame(t)).cells))
      }
    } finally {
      playing.delete(id)
    }
    await sleep(fx, 100)
  }
}

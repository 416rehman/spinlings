// The band's pure parts: the frame helpers every moment animates with (SPEC 14), the cells a Raster takes, the words
// a battle and its result read in, the stages a ceremony's text waits on, and the encounter timing the band's battles
// start on (SPEC 13: beginner's luck, a 30% roll every 15 s after 20 s, the server's spacing kept).
import { expect, test } from 'claude-code/testing'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { EYE, SHINE, spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import {
  T, TIMING, cardBack, cellAt, crossfade, dissolve, easeIn, easeOut, encodeGrid, flash, foil, glowOutline, grid, gridText, offset,
  putPixels, putText, silhouette, sparkles, squash,
} from '../../plugin/hooks/client/anim.ts'
import {
  EVOLVE_SHOW, INFO, MINI, battleWords, catchFrame, catchPreMs, evolveShowsNext, evolveStage, fighterGrid, fighterLayout,
  fightersAt, foreshadowOf, lookAt, outcomeStage, restLook, roundPlan, spriteOf, streakWords,
} from '../../plugin/hooks/client/battleview.ts'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import { encounterDue, nextCheckIn, workedAfter } from '../../plugin/hooks/client/session.ts'
import type { Battle, Moment, Outcome } from '../../plugin/hooks/client/types.ts'

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const card: Card = { ...mintCard({ species: familySpecies(seasonOf(NOW), 'opus').filter(s => !s.legendary)[0]!, rarity: 'rare', shiny: false, dna: 31, origin: 'pack', now: NOW, level: 3 }), id: 'a1' }
const px = spriteFor(card)
const same = (a: number[][], b: number[][]) => JSON.stringify(a) === JSON.stringify(b)
const opaque = (p: number[][]) => p.flat().filter(c => c !== T).length

test('frame helpers keep the size, never touch their input, and draw the same frame for the same arguments', () => {
  const before = JSON.stringify(px)
  const frames = [
    silhouette(px, 0x123456), flash(px), squash(px, 0.5), squash(px, -1), offset(px, 2, -1), glowOutline(px, 0xf2b33d, 1), sparkles(px, 0.3, 's'),
    foil(px, 1.1), dissolve(px, 0.5, 'd'), crossfade(px, flash(px), 0.5),
  ]
  for (const f of frames) {
    expect(f.length).toBe(16)
    expect(f.every(r => r.length === 16)).toBe(true)
  }
  expect(JSON.stringify(px)).toBe(before)
  expect(same(sparkles(px, 0.3, 's'), sparkles(px, 0.3, 's'))).toBe(true)
  expect(same(dissolve(px, 0.5, 'd'), dissolve(px, 0.5, 'd'))).toBe(true)
})

test('frame helpers meet their ends: squash 1 and 0, offset 0, crossfade 0 and 1, dissolve 0 and 1, flash is white', () => {
  expect(same(squash(px, 1), px)).toBe(true)
  expect(opaque(squash(px, 0))).toBe(0)
  expect(same(offset(px, 0, 0), px)).toBe(true)
  expect(same(crossfade(px, silhouette(px, 1), 0), px)).toBe(true)
  expect(same(crossfade(px, silhouette(px, 1), 1), silhouette(px, 1))).toBe(true)
  expect(same(dissolve(px, 0, 'x'), px)).toBe(true)
  expect(opaque(dissolve(px, 1, 'x'))).toBe(0)
  expect(flash(px).flat().filter(c => c !== T).every(c => c === 0xffffff)).toBe(true)
  expect(opaque(squash(px, 0.5))).toBeLessThan(opaque(px))
  expect(opaque(glowOutline(px, 0xffffff, 1))).toBeGreaterThan(opaque(px))
  expect(same(glowOutline(px, 0xffffff, 0), px)).toBe(true)
})

test('the foil sweep leaves eyes, catchlights and the outline alone, and crosses the creature every 2.4 s', () => {
  let changed = 0
  for (let t = 0; t < 2.4; t += 0.1) {
    const f = foil(px, t)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = px[y]![x]!
      if (c === EYE || c === SHINE) expect(f[y]![x]).toBe(c)
      if (f[y]![x] !== c) changed++
    }
  }
  expect(changed).toBeGreaterThan(20)
  // the band's position repeats every period: the same pixels change at t and t + 2.4
  const moved = (t: number) => foil(px, t).flat().map((c, i) => c !== px.flat()[i])
  expect(JSON.stringify(moved(0.7))).toBe(JSON.stringify(moved(3.1)))
})

test('card backs glow in their rarity\'s colour, a legendary\'s pulse moves, corners are rounded', () => {
  const edge = (r: Parameters<typeof cardBack>[2], glow = 0) => cardBack(8, 12, r, glow)[0]![3]
  expect(edge('common')).toBe(0x9aa3ad)
  expect(edge('rare')).toBe(0x4f8ff0)
  expect(edge('epic')).toBe(0xb06ef3)
  expect(edge('legendary', 0)).not.toBe(edge('legendary', 0.25))
  expect(cardBack(8, 12, 'rare')[0]![0]).toBe(T)
  expect(cardBack(8, 12, 'rare', 0.75, { mythic: true })[0]![3]).toBe(0xff7ac6)
})

test('cells: half blocks for pixels, glyphs over them, nothing wide, and base64 of 12 bytes a cell', () => {
  const g = grid(10, 2)
  putPixels(g, [[0xff0000, T], [0x00ff00, 0x0000ff]], 0, 0)
  expect(cellAt(g, 0, 0)).toEqual({ ch: '▀', fg: 0xff0000, bg: 0x00ff00 })
  expect(cellAt(g, 1, 0)).toEqual({ ch: '▄', fg: 0x0000ff, bg: 0x01000000 })
  putText(g, 2, 1, 'Hi 中', 0xffffff)
  expect(gridText(g)[1]).toBe('  Hi      ')
  putText(g, 0, 0, '7', 0xffffff, { keepBg: true })
  expect(cellAt(g, 0, 0)).toEqual({ ch: '7', fg: 0xffffff, bg: 0xff0000 })
  expect(atob(encodeGrid(g)).length).toBe(10 * 2 * 12)
})

function duel(seed = 'anim'): Battle {
  const mk = (f: 'opus' | 'fable' | 'haiku' | 'sonnet', i: number) => ({ ...mintCard({ species: familySpecies(seasonOf(NOW), f).filter(s => !s.legendary)[i]!, rarity: 'common', shiny: false, dna: 90 + i, origin: 'pack', now: NOW, level: 3 }), id: `${f}-${i}` })
  return {
    id: `anim-${seed}`, setup: { seed, kind: 'duel', arena: 'opus', rule: 'calm', rules: RULES_VERSION, attacker: [mk('opus', 0), mk('sonnet', 1)].map(toBattleCard), defender: [mk('fable', 2), mk('haiku', 3)].map(toBattleCard) },
    opponent: { kind: 'player', handle: 'soft-otter-42', league: 'Brook' }, subs: [], firstPossible: [false, false], startedAt: NOW, finishAfter: NOW,
    live: true, phase: 'fight', shown: 0, inputs: [], log: null,
  }
}

test('a fighter Raster is the size its layout says, mirrored for the defender, and its bar drains in eighths', () => {
  const b = duel()
  const log = simulateBattle(b.setup, [])
  const f = fightersAt(b, log, 2)
  const wide = fighterLayout('wide', 'a')
  expect([wide.columns, wide.rows]).toEqual([MINI + 1 + INFO, 4])
  const g = fighterGrid(f.a, restLook(f.a!.hp), wide)
  expect(gridText(g)[0]!.slice(MINI + 1)).toContain(f.a!.name.slice(0, 6))
  const d = fighterGrid(f.d, restLook(f.d!.hp), fighterLayout('wide', 'd'))
  expect(gridText(d)[0]!.trimEnd().length).toBeLessThanOrEqual(MINI + 1 + INFO)
  expect(gridText(d)[1]!).toMatch(/\d+\/\d+ [█▏▎▍▌▋▊▉░]{8}/)
  const line = fighterGrid(f.a, restLook(f.a!.hp), fighterLayout('line', 'a', 31))
  expect(line.columns).toBe(31)
  const half = fighterGrid(f.a, restLook(f.a!.maxHp / 2), wide)
  expect(gridText(half)[1]).toMatch(/████░░░░/)
})

test('a round\'s looks: the blow lands white, its number rises and fades, the knocked-out falls and is gone', () => {
  const b = duel()
  const log = simulateBattle(b.setup, [])
  for (let r = 1; r <= log.rounds.length; r++) {
    const plan = roundPlan(b, log, r, 2200)!
    for (const h of plan.hits) {
      const look = lookAt(plan, h.target, h.at + 10)
      expect(look.flash).toBe(true)
      if (h.action.dmg > 0) expect(look.popup?.text).toContain(String(h.action.dmg))
      expect(lookAt(plan, h.target, h.at + TIMING.popup + 50).popup?.text ?? '').not.toContain(`-${h.action.dmg}`)
      if (h.action.targetFainted) expect(lookAt(plan, h.target, plan.ms - 1).gone).toBe(true)
    }
    for (const side of ['a', 'd'] as const) expect(Math.round(lookAt(plan, side, plan.ms).hp)).toBe(plan.end[side])
  }
})

test('the battle\'s words: the rustle keeps the secret, the reveal names it, the ready special asks for 1', () => {
  const state = { me: null, signals: INITIAL.signals, account: INITIAL.account, cards: [card] }
  let b = duel()
  for (let i = 0; !simulateBattle(b.setup, []).rounds.some(x => x.actions.some(a => a.side === 'a' && a.move === 'special')); i++) b = duel(`anim-${i}`)
  const rustle = battleWords({ ...b, phase: 'rustle' }, state)
  expect(rustle.header).not.toMatch(/soft-otter/)
  expect(rustle.banner.map(s => s.text).join('')).toBe('soft-otter-42 wants to battle!')
  // a challenge you started says so: they never asked
  expect(battleWords({ ...b, phase: 'rustle', friendly: true }, state).banner.map(s => s.text).join('')).toBe('You challenged soft-otter-42!')
  expect(battleWords({ ...b, phase: 'reveal' }, state).banner.map(s => s.text).join('')).toMatch(/^soft-otter-42 sent out .+!$/)
  const log = simulateBattle(b.setup, [])
  const r = log.rounds.findIndex(x => x.actions.some(a => a.side === 'a' && a.move === 'special')) + 1
  const ready = battleWords({ ...b, shown: r - 1 }, state)
  expect(ready.now).toBe(true)
  expect(ready.banner.map(s => s.text).join('')).toMatch(/is ready!$/)
  const pressed = battleWords({ ...b, shown: r - 1, inputs: [r] }, state)
  expect(pressed.now).toBe(false)
  expect(pressed.banner.map(s => s.text).join('')).toMatch(/^Perfect! /)
  const subbed = battleWords({ ...b, shown: 0, subs: [{ slot: 0, cardId: b.setup.attacker[0]!.id, replaced: card.id }] }, state)
  expect(subbed.extra.map(s => s.text).join('')).toMatch(/ stepped in for /)
  expect(streakWords(2)).toBe('streak 2 · one more!')
  expect(streakWords(1)).toBe('streak 1')
  expect(streakWords(0)).toBe('')
  expect(foreshadowOf(null)).toEqual({ twinkle: false, shimmer: false, glint: false, gold: false, mythic: false })
})

test('ceremony stages wait on their beats, and motion off skips straight to the result', () => {
  const caught = toBattleCard(card) as Card
  const o: Outcome = {
    battleId: 'b', kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(card), result: 'win', sparks: 10, rating: 1000, ratingDelta: 0, league: null,
    perfect: 0, xp: [], catch: { status: 'caught', card: caught }, bounty: null, dailyWinPack: false, streak: 1, streakPack: false,
  }
  const m = { kind: 'outcome', id: 'o', outcome: o, until: NOW + 12_000 } as Extract<Moment, { kind: 'outcome' }>
  expect(outcomeStage(m, NOW + catchPreMs(caught) - 1, true)).toBe('catching')
  expect(outcomeStage(m, NOW + catchPreMs(caught), true)).toBe('caught')
  expect(outcomeStage(m, NOW, false)).toBe('caught')
  expect(catchPreMs({ species: 's1', rarity: 'common' })).toBe(4 * TIMING.spinFrame + TIMING.beat)
  expect(catchPreMs({ species: 'mythic', rarity: 'legendary' })).toBe(4 * TIMING.spinFrame + 3 * TIMING.beat)
  const e = { kind: 'evolve', id: 'e', cardId: 'a1', from: 'A', to: 'B', stage: 2, until: NOW + EVOLVE_SHOW } as Extract<Moment, { kind: 'evolve' }>
  expect(evolveStage(e, NOW + 100, true)).toBe('evolving')
  expect(evolveStage(e, NOW + TIMING.evolve, true)).toBe('evolved')
  expect(evolveStage(e, NOW + 100, false)).toBe('evolved')
  // the evolution's swaps quicken: more changes in its last second than its first
  const swaps = (from: number, to: number) => { let n = 0; for (let t = from; t < to; t += 5) if (evolveShowsNext(t) !== evolveShowsNext(t + 5)) n++; return n }
  expect(swaps(2000, 3000)).toBeGreaterThan(swaps(0, 1000) * 2)
  // a slipped creature leaves only its shadow; a caught one sparkles
  const mini = spriteOf(caught, 'mini')
  const end = catchFrame(mini, caught, catchPreMs(caught) + 2000, 'slipped')
  expect(end.flat().filter(c => c !== T).every(c => c === end.flat().find(x => x !== T))).toBe(true)
})

test('encounters: a beginner meets wild ones from 20 s of work, then a 30% roll every 15 s, never inside the server\'s spacing', () => {
  const base = { now: NOW, nextWildAt: 0, nextDuelAt: 0, lastDuelAt: 0, duelRoll: 0.9 }
  expect(nextCheckIn(0)).toBe(20_000)
  expect(nextCheckIn(25_000)).toBe(10_000)
  expect(nextCheckIn(35_000)).toBe(0)
  expect(encounterDue({ ...base, worked: 19_999, beginner: true, roll: 0.99 })).toBeNull()
  expect(encounterDue({ ...base, worked: 20_000, beginner: true, roll: 0.99 })).toBe('wild')
  expect(encounterDue({ ...base, worked: 20_000, beginner: false, roll: 0.31 })).toBeNull()
  expect(encounterDue({ ...base, worked: 20_000, beginner: false, roll: 0.29 })).toBe('wild')
  expect(encounterDue({ ...base, worked: 20_000, beginner: false, roll: 0.1, nextWildAt: NOW + 60_000 })).toBeNull()
  expect(encounterDue({ ...base, worked: 20_000, beginner: false, roll: 0.1, duelRoll: 0.1 })).toBe('duel')
  expect(encounterDue({ ...base, worked: 20_000, beginner: false, roll: 0.1, duelRoll: 0.1, lastDuelAt: NOW })).toBe('wild')
  // a beginner never duels, and never meets one inside the server's wild spacing
  expect(encounterDue({ ...base, worked: 20_000, beginner: true, roll: 0.1, duelRoll: 0.1 })).toBe('wild')
  expect(encounterDue({ ...base, worked: 80_000, beginner: true, roll: 0.99, nextWildAt: NOW + 1 })).toBeNull()
})

test('working time adds up across turns: three 8-second turns reach the 20-second check', () => {
  let worked = 0
  for (let i = 0; i < 3; i++) worked = workedAfter(worked, NOW + i * 60_000, NOW + i * 60_000 + 8_000)
  expect(worked).toBe(24_000)
  expect(encounterDue({ now: NOW, worked, beginner: true, roll: 0.99, duelRoll: 0.9, nextWildAt: 0, nextDuelAt: 0, lastDuelAt: 0 })).toBe('wild')
  expect(workedAfter(5_000, null, NOW)).toBe(5_000)
  expect(workedAfter(0, NOW + 10, NOW)).toBe(0)
})

test('easing: reveals ease out, exits ease in', () => {
  expect(easeOut(0.5)).toBeGreaterThan(0.5)
  expect(easeIn(0.5)).toBeLessThan(0.5)
  expect([easeOut(0), easeOut(1), easeIn(0), easeIn(1)]).toEqual([0, 1, 0, 1])
})

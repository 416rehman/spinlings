// The band's pure parts: the frame helpers every moment animates with (SPEC 14), the cells a Raster takes, the words
// a battle and its result read in, the stages a ceremony's text waits on, and the encounter timing the band's battles
// start on (SPEC 13: beginner's luck, a 30% roll every 15 s after 20 s, the server's spacing kept).
import { expect, test } from 'claude-code/testing'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { EYE, SHINE, spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { DAILY_RULES, seasonOf } from '../../plugin/hooks/core/world.ts'
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
import { HUD, calloutTimeline, hudSize, hudSvg } from '../../plugin/hooks/ui/band-art.tsx'
import { arenaFighterPlacement, arenaSize, arenaSvg } from '../../plugin/hooks/ui/arena-duel.ts'
import { ARENA_PNG } from '../../plugin/hooks/ui/arena-art-data.ts'
import { hex6 } from '../../plugin/hooks/ui/tokens.ts'

const attrs = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]))
const tags = (source: string, name: string): Record<string, string>[] => [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(m => attrs(m[0]))
const texts = (source: string): { p: Record<string, string>; body: string }[] => [...source.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map(m => ({ p: attrs(m[1]!), body: m[2]! }))

/** A balanced group lookup keeps scenery added after the actors out of sprite-pixel assertions. */
function groupOf(source: string, id: string): { p: Record<string, string>; body: string; from: number; to: number } | undefined {
  const opening = [...source.matchAll(/<g\b[^>]*>/g)].find(m => attrs(m[0]).id === id)
  if (!opening) return undefined
  const from = opening.index!, content = from + opening[0].length
  const groups = /<\/?g\b[^>]*>/g
  groups.lastIndex = content
  let depth = 1, next: RegExpExecArray | null
  while ((next = groups.exec(source))) {
    if (next[0].startsWith('</')) depth--
    else if (!next[0].endsWith('/>')) depth++
    if (!depth) return { p: attrs(opening[0]), body: source.slice(content, next.index), from, to: groups.lastIndex }
  }
  return undefined
}

/** Scene art may reference only its exact bundled painting or an id inside this same SVG document. */
function localArenaArt(source: string, arena: keyof typeof ARENA_PNG): void {
  // Inspect every tag locally; send one compact result to the SDK rather than an assertion per pixel attribute.
  const violations = new Set<string>()
  const images = tags(source, 'image')
  if (images.length !== 1) violations.add('image-count')
  if ((images[0]?.href ?? images[0]?.['xlink:href']) !== ARENA_PNG[arena]) violations.add('image-payload')
  const elements = [...source.matchAll(/<[\w:-]+\b[^>]*>/g)].map(m => attrs(m[0]))
  const names = elements.flatMap(p => p.id ? [p.id] : [])
  const ids = new Set(names)
  if (ids.size !== names.length) violations.add('duplicate-id')
  for (const p of elements) {
    for (const key of Object.keys(p)) if (/^on/i.test(key)) violations.add('event-attribute')
    for (const key of ['href', 'xlink:href']) if (p[key]) {
      const value = p[key]!
      if (!(value === ARENA_PNG[arena] || (value.startsWith('#') && ids.has(value.slice(1))))) violations.add('href-target')
    }
    if (p.attributeName && /^(?:href|xlink:href|on)/i.test(p.attributeName)) violations.add('animated-href-or-event')
    for (const [key, value] of Object.entries(p)) {
      if (/^xmlns(?::\w+)?$/.test(key) && ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'].includes(value)) continue
      if (/(?:https?|file|javascript):/i.test(value)) violations.add('attribute-protocol')
      for (const ref of value.matchAll(/url\(([^)]*)\)/g)) {
        const target = ref[1]!.trim().replace(/^['"]|['"]$/g, '')
        if (!(target.startsWith('#') && ids.has(target.slice(1)))) violations.add('url-target')
      }
    }
  }
  if (/<(?:script|foreignObject|iframe|a)\b/i.test(source)) violations.add('active-tag')
  expect([...violations].sort()).toEqual([])
}
const hpRects = (source: string) => {
  const rects = tags(source, 'rect')
  const track = rects.find(r => r.fill === '#3a3646' && r.rx !== undefined)!
  expect(track !== undefined).toBe(true)
  const fill = rects.find(r => r !== track && r.y === track.y && r.height === track.height && r.rx === track.rx)!
  expect(fill !== undefined).toBe(true)
  return { track, fill }
}

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

test('desktop duel HUDs keep intrinsic bounds, opaque corners and crisp art, facing inward in the wide layout', () => {
  const b = duel()
  const f = fightersAt(b, simulateBattle(b.setup, []), 1)
  expect(hudSize(HUD.wide)).toEqual({ w: 208, height: 80 })
  expect(hudSize(HUD.narrow)).toEqual({ w: 134, height: 44 })
  for (const s of [HUD.wide, HUD.narrow]) for (const side of ['a', 'd'] as const) {
    const fighter = f[side]!
    const { w, height } = hudSize(s)
    const source = hudSvg(fighter, null, side, s, { motion: false })
    const root = tags(source, 'svg')[0]!
    expect(root.viewBox).toBe(`0 0 ${w} ${height}`)
    expect([Number(root.width), Number(root.height)]).toEqual([w, height])
    const background = tags(source, 'rect')[0]!
    expect([Number(background.x ?? 0), Number(background.y ?? 0), Number(background.width), Number(background.height)]).toEqual([0, 0, w, height])
    expect(background.rx ?? '0').toBe('0')
    expect(background['fill-opacity'] ?? '1').toBe('1')
    expect(background.fill).toMatch(/^#[0-9a-f]{6}$/i)
    const artOnRight = s === HUD.wide ? side === 'a' : side === 'd'
    const artX = artOnRight ? w - s.pad - 16 * s.k : s.pad
    expect(source).toContain(`transform="translate(${artX} ${s.pad})"`)
    expect(source).toContain('shape-rendering="crispEdges"')
    const name = texts(source).find(t => t.body.includes('<tspan'))!
    expect(name !== undefined).toBe(true)
    expect(name.p['text-anchor']).toBe(side === 'a' ? 'start' : 'end')
    if (artOnRight) expect(Number(name.p.x)).toBeLessThanOrEqual(artX)
    else expect(Number(name.p.x)).toBeGreaterThan(artX + 16 * s.k)
    const charge = texts(source).find(t => t.body.includes(fighter.special))!
    expect(charge.p['text-anchor']).toBe(name.p['text-anchor'])
    expect(charge.p.x).toBe(name.p.x)
    expect(Number(charge.p.y)).toBeLessThan(height)
    const { track } = hpRects(source)
    expect(Number(track.x)).toBeGreaterThanOrEqual(0)
    expect(Number(track.x) + Number(track.width)).toBeLessThanOrEqual(w)
    expect(Number(track.y) + Number(track.height)).toBeLessThan(height)
    if (s === HUD.wide) expect(Number(track.height)).toBeGreaterThanOrEqual(8)
  }
  const empty = hudSvg(null, null, 'a', HUD.wide, { motion: false })
  expect(tags(empty, 'rect')[0]?.width).toBe('208')
  expect(texts(empty).length).toBe(0)
})

test('still desktop HP bars clamp their endpoints, keep zero HP readable and show the settled battle', () => {
  const b = duel()
  const log = simulateBattle(b.setup, [])
  const initial = fightersAt(b, log, 1)
  for (const s of [HUD.wide, HUD.narrow]) for (const side of ['a', 'd'] as const) {
    const fighter = initial[side]!
    for (const hp of [-5, 0, 1, fighter.maxHp / 2, fighter.maxHp, fighter.maxHp + 100]) {
      const source = hudSvg({ ...fighter, hp }, null, side, s, { motion: false })
      const { track, fill } = hpRects(source)
      const width = Number(fill.width), full = Number(track.width)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(full)
      if (hp <= 0) expect(width).toBe(0)
      if (hp >= fighter.maxHp) expect(width).toBe(full)
      const numbers = texts(source).find(t => /\d+\/\d+$/.test(t.body))!
      expect(numbers !== undefined).toBe(true)
      if (hp <= fighter.maxHp) expect(numbers.body).toContain(`${Math.max(0, Math.ceil(hp))}/${fighter.maxHp}`)
      expect(source).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
    }
    const settled = fightersAt(b, log, log.rounds.length + 1)[side]!
    const source = hudSvg(settled, null, side, s, { motion: true })
    expect(source).toContain(`${Math.ceil(settled.hp)}/${settled.maxHp}`)
    expect(source).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
    if (settled.hp <= 0) expect(source).not.toContain('shape-rendering="crispEdges"')
  }
})

test('desktop fighter labels escape markup, fit long names and never insert server text as SVG', () => {
  const b = duel()
  const fighter = fightersAt(b, simulateBattle(b.setup, []), 1).a!
  for (const s of [HUD.wide, HUD.narrow]) {
    const name = 'A<&"B'
    const source = hudSvg({ ...fighter, name, special: 'C<&"D' }, null, 'a', s, { motion: false })
    expect(source).toContain('A&lt;&amp;&quot;B')
    expect(source).toContain('C&lt;&amp;&quot;D')
    expect(source).not.toContain(name)
    expect(source).not.toContain('C<&"D')
    const longName = 'MarshmallowMenaceWithAnExtremelyLongName'
    const long = hudSvg({ ...fighter, name: longName }, null, 'a', s, { motion: false })
    expect(long).not.toContain(longName)
    expect(long).toContain('…')
    const label = texts(long).find(t => t.body.includes('<tspan'))!.body.replace(/<[^>]*>/g, '')
    expect(Array.from(label).length * s.font * 0.62).toBeLessThanOrEqual(s.info)
    expect(long).not.toMatch(/<(?:script|foreignObject|image)\b|(?:href|onload|onclick)=/i)
  }
})

test('desktop impacts and HP transitions use the round plan, resume its beats and stay absent with motion off', () => {
  const b = duel()
  const log = simulateBattle(b.setup, [])
  const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`
  for (let round = 1; round <= log.rounds.length; round++) {
    const plan = roundPlan(b, log, round, 2200)!
    for (const side of ['a', 'd'] as const) {
      const fighter = plan.fighters[side]!
      for (const start of [0, TIMING.windup]) {
        const source = hudSvg(fighter, plan, side, HUD.wide, { motion: true, start })
        const changes = [...plan.hits.filter(hit => hit.after[side] !== hit.before[side]).map(hit => ({ at: hit.at, hp: hit.after[side] }))]
        const lastHp = plan.hits.at(-1)?.after[side] ?? plan.start[side]
        if (plan.end[side] !== lastHp) changes.push({ at: plan.endAt, hp: plan.end[side] })
        const { track } = hpRects(source)
        for (const change of changes) {
          const width = Math.round(Number(track.width) * Math.max(0, Math.min(1, change.hp / fighter.maxHp)))
          const bar = tags(source, 'animate').find(a => a.attributeName === 'width' && a.begin === seconds(change.at - start) && a.dur === seconds(TIMING.drain))!
          expect(bar !== undefined).toBe(true)
          expect(Number(bar.to)).toBe(width)
          expect(bar.fill).toBe('freeze')
          expect(source).toContain(`${Math.ceil(change.hp)}/${fighter.maxHp}`)
        }
        for (const hit of plan.hits) if (hit.target === side && hit.action.dmg > 0) {
          const popup = texts(source).find(t => t.body.endsWith(`-${hit.action.dmg}${hit.action.crit ? '!' : ''}`))!
          expect(popup !== undefined).toBe(true)
          const pulse = tags(popup.body, 'animate').find(a => a.attributeName === 'opacity')!
          expect(pulse.begin).toBe(seconds(hit.at - start))
          expect(pulse.dur).toBe(seconds(TIMING.popup))
        }
      }
      const still = hudSvg(fighter, plan, side, HUD.wide, { motion: false })
      expect(still).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
      expect(still).toContain(`${Math.ceil(fighter.hp)}/${fighter.maxHp}`)
    }
  }
  // A heal on a hit and healing at round end have distinct beats, even if this seeded duel never needs them.
  const base = roundPlan(b, log, 1, 2200)!
  const fighter = { ...base.fighters.a!, hp: base.fighters.a!.maxHp - 20 }
  const before = { a: fighter.hp, d: base.start.d }
  const after = { a: before.a + 7, d: before.d - 5 }
  const hit = { ...base.hits[0]!, actor: 'a' as const, target: 'd' as const, before, after,
    action: { ...base.hits[0]!.action, side: 'a' as const, dmg: 5, heal: 7, targetFainted: false } }
  const healing = { ...base, fighters: { ...base.fighters, a: fighter }, start: before, hits: [hit], end: { ...after, a: after.a + 3 } }
  for (const start of [0, TIMING.windup]) {
    const source = hudSvg(fighter, healing, 'a', HUD.wide, { motion: true, start })
    for (const [amount, at] of [[7, hit.at + 120], [3, healing.endAt]]) {
      const popup = texts(source).find(t => t.body.endsWith(`+${amount}`))!
      expect(popup !== undefined).toBe(true)
      expect(tags(popup.body, 'animate').find(a => a.attributeName === 'opacity')!.begin).toBe(seconds(at! - start))
    }
    const endBar = tags(source, 'animate').find(a => a.attributeName === 'width' && a.begin === seconds(healing.endAt - start))!
    expect(Number(endBar.to)).toBe(Math.round(HUD.wide.info * healing.end.a / fighter.maxHp))
  }
})

const arenaBars = (source: string) => {
  const rects = tags(source, 'rect')
  const tracks = rects.filter(r => r.fill === '#1c2930' && r.height === '11' && r.rx === '4').sort((a, b) => Number(a.x) - Number(b.x))
  expect(tracks.length).toBe(2)
  return tracks.map(track => {
    const fill = rects.find(r => r !== track && r.fill !== '#1c2930' && r.y === track.y && r.height === track.height && r.rx === track.rx
      && Number(r.x) >= Number(track.x) && Number(r.x) <= Number(track.x) + Number(track.width))!
    expect(fill !== undefined).toBe(true)
    const element = [...source.matchAll(/<rect\b([^>]*[^/])>([\s\S]*?)<\/rect>/g)]
      .find(m => { const p = attrs(m[1]!); return p.x === fill.x && p.y === fill.y && p.width === fill.width && p.height === '11' && p.rx === '4' })!
    expect(element !== undefined).toBe(true)
    return { track, fill, animation: element[2]! }
  })
}

/** An effect-heavy, supported round: both specials, two-hit flashes, perfect sparkles, crit popups and heals. */
function arenaRound() {
  const b = duel(), base = roundPlan(b, simulateBattle(b.setup, []), 1, 2200)!
  const make = (side: 'a' | 'd') => {
    const f = base.fighters[side]!, family = side === 'a' ? 'opus' : 'fable'
    const c = mintCard({ species: familySpecies(seasonOf(NOW), family).find(s => s.legendary)!, rarity: 'legendary', shiny: true, dna: 951, origin: 'pack', now: NOW, level: 8 })
    return { ...f, card: toBattleCard({ ...c, id: `arena-${side}` }), hp: 60, maxHp: 100 }
  }
  const fighters = { a: make('a'), d: make('d') }
  const hits = [
    { ...base.hits[0]!, at: 550, actor: 'a' as const, target: 'd' as const, before: { a: 60, d: 60 }, after: { a: 67, d: 42 },
      action: { ...base.hits[0]!.action, side: 'a' as const, move: 'special' as const, special: 'crescendo' as const, perfect: true as const, hits: 2, dmg: 18, heal: 7, crit: true, targetFainted: false } },
    { ...base.hits[0]!, at: 1450, actor: 'd' as const, target: 'a' as const, before: { a: 67, d: 42 }, after: { a: 45, d: 47 },
      action: { ...base.hits[0]!.action, side: 'd' as const, move: 'special' as const, special: 'twist' as const, perfect: true as const, hits: 2, dmg: 22, heal: 5, crit: true, targetFainted: false } },
  ]
  return { ...base, fighters, hits, start: { a: 60, d: 60 }, end: { a: 48, d: 51 }, endAt: 1900, stepIn: { a: true, d: true } }
}

for (const arena of ['haiku', 'sonnet', 'opus', 'fable'] as const) test(`the ${arena} arena keeps every day, width and motion state inside the native SVG budget`, () => {
  const plan = arenaRound()
  const before = JSON.stringify(plan)
  for (const rule of DAILY_RULES) for (const columns of [40, 80, 120, 240]) for (const motion of [false, true]) {
    const source = arenaSvg({ columns, arena, rule, opponent: 'MarshmallowMenaceWithAnExtremelyLongName', fighters: plan.fighters, plan, start: 0, motion })
    const size = arenaSize(columns), root = tags(source, 'svg')[0]!
    expect(new TextEncoder().encode(source).length).toBeLessThanOrEqual(131072)
    expect(root.viewBox).toBe(`0 0 ${size.w} ${size.height}`)
    expect([Number(root.width), Number(root.height)]).toEqual([size.w, size.height])
    expect(size.w).toBeLessThanOrEqual(1280)
    expect(source).toContain('clip-path="url(#arena-clip)"')
    localArenaArt(source, arena)
    expect(source).not.toContain('repeatCount="indefinite"')
    if (!motion) expect(source).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
    else for (const damage of ['-18!', '-22!', '+7', '+5', '+3', '+4']) expect(source).toContain(damage)
  }
  expect(JSON.stringify(plan)).toBe(before)
})

test('a local battle instance distinguishes identical image documents without changing the painting or round timeline', () => {
  const plan = arenaRound()
  const strip = (source: string) => source.replace(/<metadata id="arena-instance">[\s\S]*?<\/metadata>/, '')
  const uri = (source: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source)
  for (const motion of [false, true]) {
    const scene = { columns: 80, arena: 'sonnet' as const, rule: 'calm' as const, opponent: 'Rival', fighters: plan.fighters, plan, start: 0, motion }
    const first = arenaSvg({ ...scene, instance: 'battle-first/2' })
    const second = arenaSvg({ ...scene, instance: 'battle-second/2' })
    expect(first).toContain('<metadata id="arena-instance">battle-first/2</metadata>')
    expect(second).toContain('<metadata id="arena-instance">battle-second/2</metadata>')
    expect(uri(first) === uri(second)).toBe(false)
    expect(strip(first) === strip(second)).toBe(true)
    localArenaArt(first, 'sonnet')
    localArenaArt(second, 'sonnet')
    const malformed = arenaSvg({ ...scene, instance: '</metadata><image href="https://attacker.invalid/x" onload="bad"/><script>bad</script><metadata>' })
    expect(malformed).toContain('&lt;/metadata&gt;&lt;image href=&quot;https://attacker.invalid/x&quot;')
    expect(tags(malformed, 'metadata').length).toBe(1)
    expect(tags(malformed, 'metadata')[0]!.id).toBe('arena-instance')
    expect(strip(malformed) === strip(first)).toBe(true)
    localArenaArt(malformed, 'sonnet')
    expect(new TextEncoder().encode(malformed).length).toBeLessThanOrEqual(131072)
  }
})

test('shared arena fighter labels sanitize server text, escape markup and remain anchored to readable HP panels', () => {
  const fighters = arenaRound().fighters
  const odd = 'A<&"B', long = 'MarshmallowMenaceWithAnExtremelyLongNameAndAnotherFortyCharacters'
  for (const columns of [40, 80, 120, 240]) {
    const tainted = odd + '\u001b[31m\u202e'
    const source = arenaSvg({ columns, arena: 'haiku', rule: 'calm', opponent: tainted, fighters: { a: { ...fighters.a, name: tainted }, d: { ...fighters.d, name: tainted } }, plan: null, start: 0, motion: false })
    expect(source).toContain('A&lt;&amp;&quot;B')
    expect(source).not.toContain(odd)
    expect(source).not.toContain('\u001b')
    expect(source).not.toContain('\u202e')
    localArenaArt(source, 'haiku')
    const fitted = arenaSvg({ columns, arena: 'haiku', rule: 'calm', opponent: long, fighters: { a: { ...fighters.a, name: long }, d: { ...fighters.d, name: long } }, plan: null, start: 0, motion: false })
    expect(fitted).not.toContain(long)
    expect(fitted).toContain('…')
    const bars = arenaBars(fitted)
    for (const [i, side] of ['start', 'end'].entries()) {
      const name = texts(fitted).find(t => t.p['font-size'] === (columns >= 80 ? '13' : '11') && t.p['text-anchor'] === side)!
      expect(name !== undefined).toBe(true)
      expect(name.p['font-family']).toContain('Segoe UI')
      const track = bars[i]!.track
      expect(Number(name.p.x)).toBe(Number(track.x) + (i === 1 ? Number(track.width) : 0))
      expect(Number(name.p.y)).toBeLessThan(Number(track.y))
    }
    // Rival text belongs to the real native header; that header's sanitization is covered in band.sdk.ts.
  }
})

test('larger shared-arena fighters retain a full crisp canvas inside the viewport at narrow and wide sizes', () => {
  const fighters = arenaRound().fighters
  for (const columns of [40, 60, 80, 120, 240]) {
    const source = arenaSvg({ columns, arena: 'haiku', rule: 'calm', opponent: 'Rival', fighters, plan: null, start: 0, motion: false })
    const size = arenaSize(columns), k = columns >= 80 ? 6 : 5, sprite = 16 * k
    expect(size.height).toBe(144)
    const actors = groupOf(source, 'arena-actors')
    expect(actors !== undefined).toBe(true)
    expect(actors!.p['clip-path']).toBe('url(#arena-clip)')
    const clipped = actors!.body
    const placements = tags(clipped, 'g').map(g => g.transform?.match(/^translate\(([-\d.]+) ([-\d.]+)\)$/))
      .filter((m): m is RegExpMatchArray => !!m && Number(m[2]) !== 0)
      .map(m => ({ x: Number(m[1]), y: Number(m[2]) })).sort((a, b) => a.x - b.x)
    expect(placements.length).toBe(2)
    placements.forEach(({ x, y }, i) => {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + sprite).toBeLessThanOrEqual(size.w)
      expect(y + sprite).toBeLessThanOrEqual(size.height)
      expect(x + sprite / 2).toBe(Math.round(size.w * (i === 0 ? 0.3 : 0.7) / 2) * 2)
    })
    const pixels = tags(clipped, 'rect')
    expect(pixels.length).toBeGreaterThan(0)
    expect(pixels.every(p => Number(p.height) > 0 && Number(p.width) > 0 && Number(p.height) % k === 0 && Number(p.width) % k === 0 && Number(p.x) % k === 0 && Number(p.y) % k === 0)).toBe(true)
  }
})

test('the chunky arena keeps its raw camera behind crisp actors and feathers only the world edges', () => {
  const plan = arenaRound(), violations = new Set<string>()
  for (const arena of ['haiku', 'sonnet', 'opus', 'fable'] as const) for (const columns of [40, 60, 80, 120, 240]) {
    const source = arenaSvg({ columns, arena, rule: 'calm', opponent: 'Rival', fighters: plan.fighters, plan, start: 0, motion: true })
    const { w, height } = arenaSize(columns), sprite = columns >= 80 ? 96 : 80
    const far = groupOf(source, 'arena-depth-far'), support = groupOf(source, 'arena-support')
    const actors = groupOf(source, 'arena-actors'), near = groupOf(source, 'arena-foreground')
    if (!far || !support || !actors || !near) { violations.add('missing-depth-layer'); continue }
    if (!(far.to < support.from && support.to <= actors.from && actors.to <= near.from)) violations.add('depth-layer-order')
    for (const layer of [support, actors]) {
      if (layer.p['clip-path'] !== 'url(#arena-clip)') violations.add('layer-clip')
      if (/\b(?:filter|mask)=/.test(layer.body) || layer.p.filter || layer.p.mask) violations.add('filtered-foreground')
    }
    if (!(near.p['clip-path'] === 'url(#arena-clip)' && near.p.mask === 'url(#arena-edge-mask)') || /\b(?:filter|mask)=/.test(near.body)) violations.add('near-edge-mask')
    if (tags(source, 'g').filter(p => p['clip-path'] === 'url(#arena-clip)' && p.mask === 'url(#arena-edge-mask)').length !== 2) violations.add('world-only-edge-mask')
    for (const id of ['arena-edge-mask', 'arena-edge-vertical-mask']) {
      const mask = tags(source, 'mask').find(p => p.id === id)
      if (!(mask && mask.maskUnits === 'userSpaceOnUse' && Number(mask.x) === 0 && Number(mask.y) === 0 && Number(mask.width) === w && Number(mask.height) === height)) violations.add('edge-mask-bounds')
    }
    for (const id of ['arena-edge-horizontal', 'arena-edge-vertical']) {
      const gradient = [...source.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)].find(m => attrs(m[1]!).id === id)
      const stops = gradient ? tags(gradient[2]!, 'stop') : []
      if (!(stops.length >= 4 && Number(stops[0]!.offset) === 0 && Number(stops.at(-1)!.offset) === 1 && Number(stops[0]!['stop-opacity']) === 0 && Number(stops.at(-1)!['stop-opacity']) === 0)) violations.add('edge-opacity-endpoints')
      if (!stops.slice(1, -1).every(p => Number(p['stop-opacity']) === 1 && Number(p.offset) > 0 && Number(p.offset) < 1)) violations.add('opaque-world-center')
      if (!stops.every((p, i) => i === 0 || Number(p.offset) >= Number(stops[i - 1]!.offset))) violations.add('edge-stop-order')
      if (gradient && /<(?:animate(?:Transform|Motion)?|set)\b/.test(gradient[2]!)) violations.add('animated-world-edge')
    }
    if (/<(?:filter|feGaussianBlur|feColorMatrix|feComponentTransfer)\b/.test(source) || far.p.filter || /\bfilter=/.test(far.body)) violations.add('softened-pixel-art')
    if (/<(?:animate(?:Transform|Motion)?|set|feImage)\b/.test(far.body + near.body)) violations.add('active-depth-layer')
    if (!tags(far.body, 'use').some(p => p.href === '#arena-camera-scene' && !p.filter)) violations.add('raw-camera-reference')
    if (!tags(source, 'image')[0]?.style?.includes('image-rendering:pixelated')) violations.add('smoothed-image')
    const left = Math.round(w * 0.3 / 2) * 2 - sprite / 2, right = Math.round(w * 0.7 / 2) * 2 + sprite / 2
    // Roots may continue offstage; the scene's clip and feather mask bound their visible pixels.
    const clearPoint = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= w && y >= 38 && (x < left || x > right)
    for (const p of tags(near.body, 'path')) for (const point of (p.d ?? '').matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)) {
      if (!clearPoint(Number(point[1]), Number(point[2]))) violations.add('near-path-overlap')
    }
    for (const p of tags(near.body, 'rect')) {
      if (!(clearPoint(Number(p.x), Number(p.y)) && clearPoint(Number(p.x) + Number(p.width), Number(p.y) + Number(p.height)))) violations.add('near-rect-overlap')
    }
    if (!near.body.includes('shape-rendering="crispEdges"')) violations.add('soft-near-layer')
    for (const label of source.matchAll(/<text\b([^>]*)>/g)) if (attrs(label[1]!).y === String(height - 3) && label.index! < near.to) violations.add('covered-callout')
  }
  expect([...violations].sort()).toEqual([])
})

test('daily scenery accents cannot change the current fighters, health labels or authoritative animation beats', () => {
  const plan = arenaRound(), scene = { columns: 80, arena: 'sonnet' as const, opponent: 'Rival', fighters: plan.fighters, plan, start: 550, motion: true }
  const baseline = arenaSvg({ ...scene, rule: 'calm' }), violations = new Set<string>()
  const motionTags = (source: string) => [...source.matchAll(/<(?:animate(?:Transform|Motion)?|set)\b[^>]*>/g)].map(m => m[0])
  for (const rule of DAILY_RULES) {
    const source = arenaSvg({ ...scene, rule })
    if (groupOf(source, 'arena-actors')?.body !== groupOf(baseline, 'arena-actors')?.body) violations.add('rule-changes-actors')
    if (groupOf(source, 'arena-support')?.body !== groupOf(baseline, 'arena-support')?.body) violations.add('rule-changes-contact')
    if (JSON.stringify(texts(source)) !== JSON.stringify(texts(baseline))) violations.add('rule-changes-health-or-callouts')
    if (JSON.stringify(motionTags(source)) !== JSON.stringify(motionTags(baseline))) violations.add('rule-changes-timeline')
    if (rule === 'glassDay' && source === baseline) violations.add('missing-day-accent')
  }
  expect([...violations].sort()).toEqual([])
})

test('varied creature feet meet the support plane and their contact shadows follow visible footprints', () => {
  const base = arenaRound().fighters.a, violations = new Set<string>()
  for (const family of ['haiku', 'sonnet', 'opus', 'fable'] as const) for (const stage of [1, 2, 3] as const) for (const columns of [40, 80]) {
    const c = mintCard({ species: familySpecies(seasonOf(NOW), family).find(s => !s.legendary)!, rarity: 'common', shiny: false, dna: 31, origin: 'pack', now: NOW, level: 3 })
    const f = { ...base, card: { ...toBattleCard(c), stage } }, k = columns >= 80 ? 6 : 5
    const { w, height } = arenaSize(columns), center = Math.round(w * 0.3 / 2) * 2, floor = Math.round(height * 0.88 / 2) * 2
    const px = spriteOf(f.card, 'full'), ink = px.flatMap((row, y) => row.flatMap((color, x) => color === T ? [] : [{ x, y }]))
    const bottom = Math.max(...ink.map(p => p.y)), placement = arenaFighterPlacement(f, center, floor, k, height)
    if (!placement.hasInk || !ink.length) { violations.add('missing-real-sprite'); continue }
    if (!(placement.x >= 0 && placement.y >= 0 && placement.x + 16 * k <= w && placement.y + 16 * k <= height)) violations.add('sprite-canvas-clipped')
    const visibleBottom = placement.y + (bottom + 1) * k
    if (!(placement.contactY === visibleBottom && visibleBottom <= floor && (visibleBottom === floor || placement.y + 16 * k === height))) violations.add('floating-feet')
    const feet = ink.filter(p => p.y >= bottom - 1)
    if (!(placement.contactX >= placement.x + Math.min(...feet.map(p => p.x)) * k && placement.contactX <= placement.x + (Math.max(...feet.map(p => p.x)) + 1) * k)) violations.add('detached-contact-center')
    const source = arenaSvg({ columns, arena: family, rule: 'calm', opponent: 'Rival', fighters: { a: f, d: null }, plan: null, start: 0, motion: false })
    const actor = groupOf(source, 'arena-actors'), contact = groupOf(source, 'arena-contact-a')
    if (!actor || !tags(actor.body, 'g').some(p => p.transform === `translate(${placement.x} ${placement.y})`)) violations.add('rendered-placement')
    const shadows = contact ? tags(contact.body, 'ellipse') : []
    if (!(shadows.length === 2 && shadows.every(p => Number(p.cx) === placement.contactX && Number(p.cy) >= visibleBottom && Number(p.cy) <= visibleBottom + 1 && Number(p.rx) > 0 && Number(p.rx) <= 16 * k * 0.5))) violations.add('contact-shadow-footprint')
    if (/<(?:animate(?:Transform|Motion)?|set)\b/.test(source)) violations.add('motion-off-animation')
  }
  const blank = arenaSvg({ columns: 40, arena: 'haiku', rule: 'calm', opponent: 'Rival', fighters: { a: null, d: null }, plan: null, start: 0, motion: false })
  if (groupOf(blank, 'arena-support')?.body !== '' || groupOf(blank, 'arena-actors')?.body !== '') violations.add('empty-slot-support')
  expect([...violations].sort()).toEqual([])
})

test('contact shadows fade at the existing knockout beat and resume with the creature timeline', () => {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`
  const ordinary = arenaRound(), hit = ordinary.hits[0]!
  const plan = { ...ordinary, hits: [{ ...hit, after: { a: 67, d: 0 }, action: { ...hit.action, targetFainted: true } }], end: { a: 67, d: 0 } }
  for (const start of [0, hit.at + TIMING.ko + 100, plan.ms]) {
    const source = arenaSvg({ columns: 80, arena: 'opus', rule: 'calm', opponent: 'Rival', fighters: plan.fighters, plan, start, motion: true })
    const shadow = groupOf(source, 'arena-contact-d')!, actors = groupOf(source, 'arena-actors')!
    const fade = tags(shadow.body, 'animate')
    expect(fade).toEqual([{ attributeName: 'opacity', from: '1', to: '0', begin: seconds(hit.at + TIMING.ko - start), dur: '0.2s', fill: 'freeze' }])
    expect(tags(actors.body, 'animate').some(p => p.attributeName === 'opacity' && p.begin === fade[0]!.begin && p.dur === fade[0]!.dur && p.fill === 'freeze')).toBe(true)
  }
})

test('shared arena health bars clamp empty/full endpoints and mirror defender depletion while motion is off', () => {
  const fighters = arenaRound().fighters
  for (const columns of [40, 80, 240]) for (const hp of [-5, 0, 1, 50, 100, 105]) {
    const source = arenaSvg({ columns, arena: 'sonnet', rule: 'calm', opponent: 'Rival', fighters: { a: { ...fighters.a, hp }, d: { ...fighters.d, hp } }, plan: null, start: 0, motion: false })
    const bars = arenaBars(source)
    bars.forEach(({ track, fill }, i) => {
      const width = Number(track.width), actual = Number(fill.width), expected = Math.round(width * Math.max(0, Math.min(1, hp / 100)))
      expect(actual).toBe(expected)
      expect(Number(fill.x)).toBe(Number(track.x) + (i === 1 ? width - actual : 0))
      expect(Number(track.x) + width).toBeLessThanOrEqual(arenaSize(columns).w)
    })
    expect(source).toContain(`HP ${Math.max(0, Math.ceil(hp))}/100`)
    expect(source).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
  }
})

test('shared arena HP drains, healing and resumed digits follow each authoritative beat with one visible label per fighter', () => {
  const plan = arenaRound()
  const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`
  for (const columns of [40, 80, 120]) for (const start of [0, 1000, 1700, plan.endAt + TIMING.drain + 1]) {
    const source = arenaSvg({ columns, arena: 'fable', rule: 'sonnetDay', opponent: 'Rival', fighters: plan.fighters, plan, start, motion: true })
    const bars = arenaBars(source)
    bars.forEach(({ track, animation }, i) => {
      const side = i === 0 ? 'a' : 'd', width = Number(track.width)
      const changes = [...plan.hits.map(hit => ({ at: hit.at, hp: hit.after[side] })), { at: plan.endAt, hp: plan.end[side] }]
      const steps = tags(animation, 'animate')
      let previous = plan.start[side]
      for (const change of changes) {
        const to = Math.round(width * change.hp / 100), from = Math.round(width * previous / 100)
        const drain = steps.find(a => a.attributeName === 'width' && a.begin === seconds(change.at - start))!
        expect(drain !== undefined).toBe(true)
        expect([Number(drain.from), Number(drain.to)]).toEqual([from, to])
        expect(drain.dur).toBe(seconds(TIMING.drain))
        expect(drain.fill).toBe('freeze')
        if (side === 'd') {
          const mirror = steps.find(a => a.attributeName === 'x' && a.begin === drain.begin)!
          expect([Number(mirror.from), Number(mirror.to)]).toEqual([Number(track.x) + width - from, Number(track.x) + width - to])
        }
        previous = change.hp
      }
    })
    const digits = [...source.matchAll(/<g visibility="(visible|hidden)">((?:<set\b[^>]*\/>)*<g\b[^>]*><text\b[^>]*>HP [^<]*<\/text><\/g>)<\/g>/g)]
    for (const side of ['a', 'd'] as const) {
      const track = bars[side === 'a' ? 0 : 1]!.track
      const center = Number(track.x) + Number(track.width) / 2
      const group = digits.filter(m => Number(texts(m[2]!)[0]!.p.x) === center)
      expect(group.length).toBe(4)
      const visible = group.filter(m => m[1] === 'visible')
      expect(visible.length).toBe(1)
      const label = texts(visible[0]![2]!)[0]!
      expect(label.p['text-anchor']).toBe('middle')
      expect(Number(label.p.y)).toBeGreaterThan(Number(track.y))
      expect(Number(label.p.y)).toBeLessThanOrEqual(Number(track.y) + Number(track.height))
      let hp = plan.start[side]
      for (const hit of plan.hits) if (hit.at + TIMING.drain / 2 <= start) hp = hit.after[side]
      if (plan.endAt + TIMING.drain / 2 <= start) hp = plan.end[side]
      expect(texts(visible[0]![2]!)[0]!.body).toBe(`HP ${hp}/100`)
      for (const m of group) for (const change of tags(m[2]!, 'set')) expect(Number.parseFloat(change.begin!)).toBeGreaterThan(0)
    }
  }
})

test('shared arenas explain hits and trait ownership with the terminal callouts, including resumed and knockout beats', () => {
  const base = arenaRound()
  const fighters = {
    a: { ...base.fighters.a, card: { ...base.fighters.a.card, traits: ['moonlit', 'guardian'] as Card['traits'] } },
    d: { ...base.fighters.d, card: { ...base.fighters.d.card, traits: ['moonlit'] as Card['traits'] } },
  }
  const plan = { ...base, fighters, ms: 3600, endAt: 3000, end: { a: 0, d: 47 }, hits: [
    { ...base.hits[0]!, action: { ...base.hits[0]!.action, effect: 'super' as const, traits: ['moonlit'] as Card['traits'] } },
    { ...base.hits[1]!, after: { a: 0, d: 47 }, action: { ...base.hits[1]!.action, dmg: 67, effect: 'weak' as const, traits: ['moonlit', 'guardian'] as Card['traits'], targetFainted: true } },
  ] }
  const timeline = [...calloutTimeline(plan, 'a'), ...calloutTimeline(plan, 'd')]
  for (const label of ['Perfect!', 'Critical!', 'Super effective!', 'Not very effective…', 'Moonlit!', 'Guardian!', 'Fainted']) {
    expect(timeline.some(c => c.text === label)).toBe(true)
  }
  for (const columns of [40, 80]) for (const start of [0, 550, 950, 1500, plan.ms]) {
    const source = arenaSvg({ columns, arena: 'opus', rule: 'calm', opponent: 'Rival', fighters, plan, start, motion: true })
    const height = arenaSize(columns).height, width = arenaSize(columns).w
    const callouts = [...source.matchAll(/<g visibility="(visible|hidden)"[^>]*>((?:<set\b[^>]*\/>)*<text\b[^>]*>[^<]*<\/text>)<\/g>/g)]
      .filter(m => texts(m[2]!)[0]!.p.y === String(height - 3))
    for (const side of ['a', 'd'] as const) {
      const center = Math.round(width * (side === 'a' ? 0.3 : 0.7) / 2) * 2
      const groups = callouts.filter(m => texts(m[2]!)[0]!.p.x === String(center))
      const expected = lookAt(plan, side, start).callout
      const visible = groups.filter(m => m[1] === 'visible')
      expect(visible.length).toBe(expected ? 1 : 0)
      if (expected) {
        const label = texts(visible[0]![2]!)[0]!
        expect(label.body).toBe(expected.text)
        expect(label.p.fill).toBe(hex6(expected.color))
      }
      for (const group of groups) for (const change of tags(group[2]!, 'set')) expect(Number.parseFloat(change.begin!)).toBeGreaterThan(0)
    }
    const still = arenaSvg({ columns, arena: 'opus', rule: 'calm', opponent: 'Rival', fighters, plan, start, motion: false })
    expect(texts(still).some(t => t.p.y === String(height - 3))).toBe(false)
  }
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

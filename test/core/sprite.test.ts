import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Accessory, Body, Card, Eyes, Family, Form, Mouth, Pattern, Trinket } from '../../plugin/hooks/core/types.ts'
import { formLook, fuse, look } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, inHueRange } from '../../plugin/hooks/core/families.ts'
import { mythicForm } from '../../plugin/hooks/core/mythics.ts'
import { ARMS, EARS, HEADS, LEGS, MUZZLES, TAILS, WINGS, partsFor } from '../../plugin/hooks/core/parts.ts'
import { rngFromSeed, uint32 } from '../../plugin/hooks/core/rng.ts'
import { BODIES, familySpecies, getSpecies, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import {
  EYE, MOSAIC, MOTE_A, MOTE_B, SHINE, SIZE, SPARK, base64, bodyHue, draw, emojiFor, emojiMosaic, formParts, miniSprite,
  raisedHue, silhouette, spriteFor, toRaster, toSvg,
} from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { card, NOW } from './helpers.ts'

function valid(px: Pixels, size = SIZE) {
  assert.equal(px.length, size)
  for (const row of px) {
    assert.equal(row.length, size)
    for (const c of row) assert.ok(c === -1 || (Number.isInteger(c) && c >= 0 && c <= 0xffffff), `colour ${c}`)
  }
}

const opaque = (px: Pixels) => px.flat().filter(c => c !== -1).length
const isEye = (c: number) => c === EYE
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const GOLD = 0xf2c445, GOLD_LIGHT = 0xfff0a8
const STARS = new Set([SPARK, MOTE_A, MOTE_B])

const hueOf = (v: number) => {
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return -1
  const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  return (h * 60 + 360) % 360
}
const lightness = (v: number) => (Math.max(v >> 16, (v >> 8) & 255, v & 255) + Math.min(v >> 16, (v >> 8) & 255, v & 255)) / 510
const gap = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)
/** the most common clearly coloured pixel inside the outline: the body's base tone */
const mainColour = (px: Pixels) => {
  const thin = thinColours(px)
  const counts = new Map<number, number>()
  for (const v of px.flat()) if (v !== -1 && !thin.has(v) && Math.max(v >> 16, (v >> 8) & 255, v & 255) > 90) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

/** The 4-connected cells reachable from (x, y) through pixels that pass `keep`. */
function component(px: Pixels, x: number, y: number, keep = (c: number) => c !== -1): Set<number> {
  const seen = new Set<number>([y * SIZE + x])
  const todo = [[x, y]]
  while (todo.length) {
    const [cx, cy] = todo.pop()!
    for (const [dx, dy] of N4) {
      const nx = cx! + dx, ny = cy! + dy, c = px[ny]?.[nx]
      if (c === undefined || !keep(c) || seen.has(ny * SIZE + nx)) continue
      seen.add(ny * SIZE + nx)
      todo.push([nx, ny])
    }
  }
  return seen
}

/** Colours that mostly touch the open air: the outline, unoutlined stalks, the halo, a twinkle's arms. */
function thinColours(px: Pixels): Set<number> {
  const edge = new Map<number, number>(), count = new Map<number, number>()
  px.forEach((r, y) => r.forEach((c, x) => {
    if (c === -1) return
    count.set(c, (count.get(c) ?? 0) + 1)
    if (N4.some(([dx, dy]) => (px[y + dy]?.[x + dx] ?? -1) === -1)) edge.set(c, (edge.get(c) ?? 0) + 1)
  }))
  return new Set([...edge].filter(([c, n]) => n >= 0.6 * count.get(c)!).map(([c]) => c))
}

/**
 * Both eyes show (one on each side) and every opaque pixel is joined to them, outline included. Only a halo,
 * which floats unoutlined in the upper half, and the sparkles of a shiny or a Mythic may stand apart.
 */
function connectedWithEyes(px: Pixels, label: string) {
  const eyes = px.flatMap((r, y) => r.flatMap((c, x) => (isEye(c) ? [[x, y] as const] : [])))
  assert.ok(eyes.some(([x]) => x < 8) && eyes.some(([x]) => x >= 8), `${label}: both eyes visible`)
  const [ex, ey] = eyes[0]!
  const main = component(px, ex, ey)
  let apart = 0
  px.forEach((r, y) => r.forEach((c, x) => {
    if (c === -1 || main.has(y * SIZE + x)) return
    const star = component(px, x, y)
    if ([...star].some(k => STARS.has(px[Math.floor(k / SIZE)]![k % SIZE]!))) return
    apart++
    assert.ok(y < 8, `${label}: stray pixel at ${x},${y}`)
  }))
  assert.ok(apart <= 16, `${label}: ${apart} pixels apart from the creature`)
  return apart
}

/**
 * No floating beads: apart from the outline and its kin, every group of pixels that does not touch the body
 * orthogonally has at least 3 pixels (an antenna bud on its stalk), so nothing reads as a stray dot.
 */
function noBeads(px: Pixels, label: string) {
  const thin = thinColours(px)
  // a pixel is outline-like when its colour mostly rims the creature and it touches the open air itself
  const open = (x: number, y: number) => N4.some(([dx, dy]) => (px[y + dy]?.[x + dx] ?? -1) === -1)
  const plain = (x: number, y: number) => { const c = px[y]?.[x] ?? -1; return c !== -1 && !STARS.has(c) && !(thin.has(c) && open(x, y)) }
  // a twinkle's heart floats apart; a speck of light painted on the body belongs to it
  const fill = (x: number, y: number) => plain(x, y) || (STARS.has(px[y]?.[x] ?? -1) && N4.some(([dx, dy]) => plain(x + dx, y + dy)))
  const seen = new Set<number>()
  const sizes: number[] = []
  px.forEach((r, y) => r.forEach((_, x) => {
    if (!fill(x, y) || seen.has(y * SIZE + x)) return
    const comp = new Set<number>([y * SIZE + x])
    const todo = [[x, y]]
    while (todo.length) {
      const [cx, cy] = todo.pop()!
      for (const [dx, dy] of N4) {
        const nx = cx! + dx, ny = cy! + dy
        if (!fill(nx, ny) || comp.has(ny * SIZE + nx)) continue
        comp.add(ny * SIZE + nx)
        todo.push([nx, ny])
      }
    }
    for (const k of comp) seen.add(k)
    sizes.push(comp.size)
  }))
  sizes.sort((a, b) => b - a)
  for (const n of sizes.slice(1)) assert.ok(n >= 3, `${label}: a ${n}-pixel bead (${sizes.join(',')})`)
}

/** Silhouettes that differ from every one kept so far by at least `min` pixels. */
function distinct(list: Pixels[], min = 4): number {
  const masks = list.map(px => px.flat().map(c => c !== -1))
  const kept: boolean[][] = []
  for (const m of masks) if (!kept.some(k => k.reduce((n, v, i) => n + (v !== m[i] ? 1 : 0), 0) < min)) kept.push(m)
  return kept.length
}

const plainForm = (body: Body, family: Family = 'opus', over: Partial<Form> = {}): Form => ({
  family, body, hue: familySpecies(1, family)[0]!.hue, pattern: 'none', accessory: 'horns',
  base: { hp: 30, atk: 12, def: 10, spd: 10 }, names: ['Pebblet', 'Pebblemaw', 'Pebbletitan'], legendary: false, ...over,
})

test('every species draws a valid 16x16 at every stage, deterministically, with nothing floating', () => {
  for (const season of [1, 2]) for (const s of seasonSpecies(season)) for (const stage of [1, 2, 3] as const) {
    const px = spriteFor({ form: s, stage })
    valid(px)
    assert.ok(opaque(px) > 40, `${s.id} stage ${stage} too empty`)
    connectedWithEyes(px, `${s.id} stage ${stage}`)
    assert.deepEqual(spriteFor({ form: s, stage }), px)
  }
})

test('no floating beads: every part reaches the body, across seasons, stages, raising families and shinies', () => {
  for (let season = 1; season <= 12; season++) for (const s of seasonSpecies(season)) for (const stage of [1, 2, 3] as const) {
    noBeads(spriteFor({ form: s, stage }), `${s.id} stage ${stage}`)
    if (stage > 1) noBeads(spriteFor({ form: s, stage, raisedIn: FAMILIES[season % 4]! }), `${s.id} raised stage ${stage}`)
    if (season <= 3) noBeads(spriteFor({ ...card(s, {}, season * 31 + stage), shiny: true, stage }), `${s.id} shiny stage ${stage}`)
  }
})

test('parts come from the seed alone: same seed, same creature; the frame stays clear for the outline', () => {
  for (let i = 0; i < 60; i++) {
    const body = BODIES[i % 6]!
    assert.deepEqual(partsFor('det/' + i, body), partsFor('det/' + i, body))
    const form = plainForm(body)
    const a = spriteFor({ form, seed: 'det/' + i, stage: 2 })
    assert.deepEqual(spriteFor({ form, seed: 'det/' + i, stage: 2 }), a)
    for (let k = 0; k < SIZE; k++) for (const [x, y] of [[k, 0], [k, 15], [0, k], [15, k]] as const) {
      assert.ok(a[y]![x] === -1 || !isEye(a[y]![x]!), 'nothing but outline touches the frame')
    }
  }
  assert.notDeepEqual(partsFor('a', 'blob'), partsFor('b', 'blob'))
})

test('every part combination yields a valid, connected sprite with both eyes visible', () => {
  const accessories: Accessory[] = ['horns', 'crown', 'antennae', 'spikes', 'wings']
  const eyes: Eyes[] = ['dot', 'tall', 'sparkle', 'sleepy', 'fierce']
  const patterns: Pattern[] = ['none', 'spots', 'stripes', 'belly', 'mask']
  const trinkets: Trinket[] = ['none', 'hat', 'bow', 'flower', 'scarf', 'monocle']
  let n = 0
  for (const torso of BODIES) for (const head of HEADS) for (const ears of EARS) for (const wings of WINGS) for (const tail of TAILS) for (const legs of LEGS) {
    const p = {
      ...partsFor('combo/' + n, torso), head, ears, wings, tail, legs,
      arms: ARMS[n % 3]!, muzzle: MUZZLES[(n >> 1) % 3]!, earSize: 1 + (n % 3), tailSize: 1 + ((n >> 2) % 3),
      eyeGap: 1 + ((n >> 3) % 3), side: (n % 5 < 2 ? 1 : -1) as 1 | -1, tilt: n % 7 < 3,
    }
    if (head === 'merged') p.th = Math.max(p.th, 7)
    const form = plainForm(torso, FAMILIES[n % 4]!, { accessory: accessories[n % 5]! })
    const lk = { ...formLook(form), eyes: eyes[n % 5]!, pattern: patterns[(n >> 2) % 5]!, trinket: trinkets[(n >> 1) % 6]!, shapeSeed: n }
    const px = draw(form, lk, (n % 3 + 1) as 1 | 2 | 3, n % 11 === 0, { parts: p })
    valid(px)
    assert.equal(connectedWithEyes(px, `${torso}/${head}/${ears}/${wings}/${tail}/${legs}`), 0, 'no halo here, so nothing floats')
    n++
  }
  assert.equal(n, 6 * 4 * 11 * 5 * 5 * 4)
})

test('silhouettes are varied: seeds at stage 1 and every season species at each stage', () => {
  // distinct means differing from every other kept silhouette by 4 or more pixels, a difference a player sees
  const seeds = Array.from({ length: 500 }, (_, i) => spriteFor({ form: plainForm(BODIES[i % 6]!), seed: 'silhouette/' + i, stage: 1 }))
  assert.ok(distinct(seeds) >= 430, `stage 1: ${distinct(seeds)} distinct of 500 seeds`)
  const species = Array.from({ length: 14 }, (_, i) => seasonSpecies(i + 1).filter(s => !s.legendary)).flat()
  for (const stage of [1, 2, 3] as const) {
    const n = distinct(species.map(s => spriteFor({ form: s, stage })))
    assert.ok(n >= 0.95 * species.length, `stage ${stage}: ${n} distinct of ${species.length} species`)
  }
})

test('each evolution keeps the species and grows; the final stage unlocks a part or changes the outline', () => {
  let changed = 0, total = 0, grown = 0, cards = 0, up2 = 0, up3 = 0, lower = 0
  const top = (px: Pixels) => px.findIndex(r => r.some(c => c !== -1))
  for (const season of [1, 2, 3, 4]) for (const s of seasonSpecies(season).filter(x => !x.legendary)) {
    for (const dna of [7, 99, 12345]) {
      const c = card(s, {}, dna)
      const [a, b, d] = ([1, 2, 3] as const).map(stage => spriteFor({ ...c, stage }))
      cards++
      if (opaque(b) > opaque(a)) up2++
      if (opaque(d) > opaque(b)) up3++
      if (top(b) > top(a) || top(d) > top(b)) lower++
      grown += opaque(d) - opaque(b)
    }
    const [p1, p2, p3] = ([1, 2, 3] as const).map(stage => formParts(s, stage, false))
    for (const k of ['torso', 'head', 'ears', 'muzzle', 'eyeGap', 'side'] as const) assert.ok(p2[k] === p1[k] && p3[k] === p1[k], `${s.id} keeps ${k}`)
    for (const k of ['tail', 'wings', 'arms'] as const) assert.equal(p2[k], k === 'wings' && p1.wings === 'small' ? 'large' : p1[k], `${s.id} keeps ${k} at stage 2`)
    // at most one part is new at stage 3, and only where there was none (or nub arms start to wave)
    const fresh = (['tail', 'wings', 'arms'] as const).filter(k => p3[k] !== p2[k])
    assert.ok(fresh.length <= 1, `${s.id} unlocks one part`)
    for (const k of fresh) assert.ok(p2[k] === 'none' || (k === 'arms' && p2.arms === 'nubs'), `${s.id} unlocks ${k}`)
    assert.ok(p2.tw >= p1.tw && p2.th > p1.th && p3.th > p2.th && p3.earSize >= p2.earSize, `${s.id} parts grow`)
    const [two, three] = ([2, 3] as const).map(stage => spriteFor({ form: s, stage }))
    const diff = two.flat().filter((v, i) => (v === -1) !== (three.flat()[i] === -1)).length
    total++
    if (diff >= 25 || fresh.length) changed++
  }
  assert.ok(changed >= 0.95 * total, `stage 3 visibly new for ${changed} of ${total}`)
  // the body never shrinks to make room for what it wears; an accessory may take the place of tall ears, so a few
  // creatures trade a little size for it
  assert.ok(up2 >= 0.97 * cards && up3 >= 0.97 * cards, `bigger at stage 2: ${up2}, at stage 3: ${up3} of ${cards}`)
  assert.ok(lower <= 0.02 * cards, `${lower} of ${cards} reach less high after evolving`)
  assert.ok(grown / cards >= 15, `stage 3 is ${(grown / cards).toFixed(1)} pixels bigger on average`)
})

test('legendaries and Mythics never evolve: one final form whatever the stage', () => {
  for (const l of seasonSpecies(1).filter(x => x.legendary)) {
    const c = card(l)
    const final = spriteFor({ ...c, stage: 3 })
    for (const stage of [1, 2] as const) assert.deepEqual(spriteFor({ ...c, stage }), final, l.id)
    assert.deepEqual(formParts(l, 1, true), formParts(l, 3, true))
  }
})

test('dna varies the silhouette a little; the species stays recognisable', () => {
  for (const s of [familySpecies(1, 'haiku')[0]!, familySpecies(1, 'opus')[2]!, familySpecies(1, 'fable')[5]!]) {
    const rng = rngFromSeed('dna/' + s.id)
    const ref = spriteFor(card(s, {}, 1))
    const all: Pixels[] = []
    for (let i = 0; i < 40; i++) {
      const px = spriteFor(card(s, {}, uint32(rng)))
      all.push(px)
      let both = 0, either = 0
      px.forEach((r, y) => r.forEach((c, x) => { const a = c !== -1, b = ref[y]![x] !== -1; if (a && b) both++; if (a || b) either++ }))
      assert.ok(both / either >= 0.7, `${s.id}: overlap ${(both / either).toFixed(2)}`)
    }
    assert.ok(distinct(all) >= 4, `${s.id}: ${distinct(all)} visibly different silhouettes`)
  }
})

test('the body is mirrored, with controlled asymmetry for liveliness', () => {
  let lopsided = 0
  for (const s of seasonSpecies(1)) {
    const px = spriteFor({ form: s })
    if (px.some(r => r.some((c, x) => (c === -1) !== (r[15 - x] === -1)))) lopsided++
  }
  assert.ok(lopsided >= 9 && lopsided <= 33, `${lopsided} of 36 asymmetric`)
})

test('every body, pattern, eye, mouth, trinket and accessory combination draws in bounds', () => {
  const s = familySpecies(1, 'fable')[0]!
  const base = look(card(s))
  const patterns: Pattern[] = ['none', 'spots', 'stripes', 'belly', 'mask']
  const eyes: Eyes[] = ['dot', 'tall', 'sparkle', 'sleepy', 'fierce']
  const mouths: Mouth[] = ['none', 'smile', 'fang', 'o']
  const trinkets: Trinket[] = ['none', 'hat', 'bow', 'flower', 'scarf', 'monocle']
  const accessories: Accessory[] = ['horns', 'crown', 'antennae', 'halo', 'spikes', 'wings']
  let n = 0
  for (const body of BODIES) for (const accessory of accessories) for (const stage of [1, 2, 3] as const) for (const legendary of [false, true]) {
    const form = { ...s, body, accessory }
    for (let i = 0; i < 6; i++) {
      const lk = { ...base, pattern: patterns[i % 5]!, eyes: eyes[(i + n) % 5]!, mouth: mouths[i % 4]!, trinket: trinkets[(i + n) % 6]!, shiny: i === 3 }
      const px = draw(form, lk, stage, legendary)
      valid(px)
      connectedWithEyes(px, `${body}/${accessory}/${stage}/${i}`)
      n++
    }
  }
  assert.ok(n > 800)
})

test('trinkets show on every creature: a hat only on a bare head, the rest clear of the face', () => {
  for (const s of seasonSpecies(1)) for (const stage of [1, 2, 3] as const) {
    const plain = draw(s, formLook(s), stage, s.legendary)
    for (const trinket of ['hat', 'bow', 'flower', 'scarf', 'monocle'] as const) {
      const px = draw(s, { ...formLook(s), trinket }, stage, s.legendary)
      connectedWithEyes(px, `${s.id} ${trinket}`)
      const bare = stage === 1 && !s.legendary
      if (trinket !== 'hat' || bare) assert.notDeepEqual(px, plain, `${s.id} stage ${stage} shows its ${trinket}`)
      assert.equal(px.flat().filter(isEye).length, plain.flat().filter(isEye).length, `${s.id} ${trinket} keeps both eyes whole`)
      if (trinket === 'monocle') assert.ok(px.flat().includes(GOLD), `${s.id}: a gold monocle`)
    }
  }
})

test('raised forms: the raising family restyles the accessory and tints the hue, deeper at stage 3, inside the family', () => {
  /** the modal 15-degree hue band of the clearly coloured pixels: the body's band, whatever the accessory */
  const mainHue = (px: Pixels) => {
    const bands = new Map<number, number>()
    for (const v of px.flat()) {
      if (v === -1) continue
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
      const band = Math.floor(hueOf(v) / 15)
      bands.set(band, (bands.get(band) ?? 0) + 1)
    }
    return [...bands.entries()].sort((a, b) => b[1] - a[1])[0]![0] * 15 + 7.5
  }
  for (const s of familySpecies(1, 'sonnet').slice(0, 8)) {
    const c = card(s)
    for (const stage of [2, 3] as const) {
      const looks = FAMILIES.map(f => spriteFor({ ...c, stage, raisedIn: f }))
      assert.equal(new Set(looks.map(px => JSON.stringify(px))).size, 4, `${s.id}: four raised looks at stage ${stage}`)
      assert.deepEqual(looks[FAMILIES.indexOf('sonnet')], spriteFor({ ...c, stage }), 'raised at home is the plain form')
      for (const px of looks) {
        const h = mainHue(px)
        assert.ok(inHueRange('sonnet', h - 7.5) || inHueRange('sonnet', h + 7.5), `${s.id} stays blue: ${h}`)
      }
    }
    assert.deepEqual(spriteFor({ ...c, stage: 1, raisedIn: 'opus' }), spriteFor({ ...c, stage: 1 }), 'stage 1 ignores raising')
  }
  // the tint itself: 20% of the way at stage 2, 35% at stage 3, clamped into the family's range
  assert.equal(raisedHue(222, 'sonnet', 'sonnet', 3), 222)
  assert.equal(raisedHue(222, 'sonnet', 'fable', 1), 222)
  assert.ok(Math.abs(raisedHue(200, 'sonnet', 'fable', 2) - (200 + 0.2 * 90)) < 1e-9)
  assert.ok(Math.abs(raisedHue(200, 'sonnet', 'fable', 3) - (200 + 0.35 * 90)) < 1e-9)
  for (const f of FAMILIES) for (const r of FAMILIES) for (let h = 0; h < 360; h += 15) {
    if (!inHueRange(f, h)) continue
    const two = raisedHue(h, f, r, 2), three = raisedHue(h, f, r, 3)
    assert.ok(inHueRange(f, two) && inHueRange(f, three), `${f} raised under ${r} stays ${f}`)
    assert.ok(gap(three, h) >= gap(two, h) - 1e-9, 'the stage-3 tint is at least as deep')
  }
})

test('the head top holds one thing: a fable crescent or halo ring is always whole and nothing pokes through it', () => {
  const MOON = 0xfff1b8
  for (let season = 1; season <= 10; season++) for (const s of seasonSpecies(season).filter(x => !x.legendary && x.family !== 'fable')) {
    for (const stage of [2, 3] as const) {
      const px = spriteFor({ form: s, stage, raisedIn: 'fable' })
      assert.equal(px.flat().filter(c => c === MOON).length, stage === 3 ? 8 : 6, `${s.id} stage ${stage}: the whole crescent`)
    }
  }
  // a halo ring floats on its own, a clear row above the head, touching nothing, never cut short
  for (let season = 1; season <= 10; season++) for (const s of seasonSpecies(season).filter(x => x.accessory === 'halo' && x.family !== 'fable')) {
    for (const stage of [2, 3] as const) {
      const px = spriteFor({ form: s, stage })
      const [ex, ey] = px.flatMap((r, y) => r.flatMap((c, x) => (isEye(c) ? [[x, y] as const] : [])))[0]!
      const main = component(px, ex, ey)
      const [hx, hy] = px.flatMap((r, y) => r.flatMap((c, x) => (c !== -1 && !main.has(y * SIZE + x) ? [[x, y] as const] : [])))[0] ?? [0, 0]
      const ring = component(px, hx, hy)
      assert.ok([10, 12, 16].includes(ring.size), `${s.id} stage ${stage}: a halo ring of ${ring.size}`)
      assert.ok([...ring].every(k => k < ey * SIZE), `${s.id}: the halo floats above the head`)
    }
  }
})

test('legendaries are gilded and crowned; Mythics glow, halo-crowned and two-toned, each one of a kind', () => {
  for (const f of FAMILIES) {
    const l = familySpecies(1, f)[8]!
    const px = spriteFor({ form: l })
    assert.ok(px.flat().some(c => c === GOLD || c === GOLD_LIGHT), `${l.id} gold`)
    const plain = draw({ ...l, legendary: false }, formLook(l), 3, false)
    assert.notDeepEqual(px, plain, `${l.id}: the gold rim light`)
  }
  const seen: Pixels[] = []
  let paired = 0
  for (let i = 0; i < 60; i++) {
    const m = mythicForm('mythic/' + i)
    const px = spriteFor({ form: m, stage: 2 })
    valid(px)
    assert.deepEqual(spriteFor({ form: m, stage: 1 }), px)
    seen.push(px)
    const sparkles = px.flat().filter(c => c === MOTE_A).length
    assert.ok(sparkles >= 1, `mythic ${i} sparkles`)
    if (sparkles === 2) paired++
    connectedWithEyes(px, `mythic ${i}`)
    const brow = px.findIndex(r => r.some(isEye)) - 1
    assert.ok(px.slice(0, brow).flat().filter(c => c === GOLD || c === GOLD_LIGHT).length >= 5, `mythic ${i} wears a gold halo`)
    // a light aura instead of a dark outline
    const rim = px.flat().filter((c, k) => c !== -1 && N4.some(([dx, dy]) => (px[Math.floor(k / SIZE) + dy]?.[(k % SIZE) + dx] ?? -1) === -1))
    assert.ok(rim.filter(c => lightness(c) > 0.6).length > rim.length / 2, `mythic ${i} glows`)
  }
  assert.ok(distinct(seen) >= 55, `${distinct(seen)} distinct Mythics of 60`)
  assert.ok(paired >= 55, `${paired} of 60 Mythics have a sparkle in two corners`)
  // iridescent: the head and the body sit at opposite ends of the family's band
  const m = mythicForm('two-tone')
  const px = spriteFor({ form: m })
  const eyeRow = px.findIndex(r => r.some(isEye))
  const top = mainColour(px.slice(0, eyeRow + 2)), low = mainColour(px.slice(eyeRow + 4))
  assert.ok(gap(hueOf(top), hueOf(low)) >= 20, `two hues ${hueOf(top)} and ${hueOf(low)}`)
})

test('dna gives each card its own look; a shiny stays in its family, turns gold-accented and always twinkles', () => {
  const s = familySpecies(1, 'haiku')[2]!
  const rng = rngFromSeed('looks')
  const seen = new Set<string>()
  for (let i = 0; i < 40; i++) seen.add(JSON.stringify(spriteFor(card(s, {}, uint32(rng)))))
  assert.ok(seen.size >= 38, `${seen.size} distinct of 40`)
  for (const season of [1, 2, 3]) for (const sp of seasonSpecies(season)) for (const stage of [1, 2, 3] as const) {
    const c = card(sp, {}, season * 97 + stage)
    const plain = spriteFor({ ...c, stage }), shiny = spriteFor({ ...c, shiny: true, stage })
    assert.notDeepEqual(plain, shiny)
    assert.ok(shiny.flat().includes(SPARK), `${sp.id} stage ${stage}: a shiny always twinkles`)
    const h = hueOf(mainColour(shiny))
    assert.ok(inHueRange(sp.family, h - 6) || inHueRange(sp.family, h + 6), `${sp.id} shiny stays ${sp.family}: ${h}`)
  }
  for (const f of FAMILIES) for (let t = 0; t <= 1; t += 0.05) {
    const hue = (f === 'opus' ? 345 + t * 55 : f === 'haiku' ? 85 + t * 80 : f === 'sonnet' ? 190 + t * 65 : 260 + t * 60) % 360
    assert.ok(inHueRange(f, bodyHue(f, hue, true)), `${f}: shiny hue ${bodyHue(f, hue, true)} in range`)
    assert.ok(gap(bodyHue(f, hue, true), bodyHue(f, hue)) >= 15, `${f}: a shiny moves away from its plain hue`)
  }
})

test('families are told apart by colour, at least 35 degrees apart on screen', () => {
  const ranges = { haiku: [70, 175], sonnet: [180, 250], opus: [340, 50], fable: [255, 325] } as const
  for (const f of FAMILIES) {
    for (const s of familySpecies(1, f).filter(x => !x.legendary)) {
      const h = hueOf(mainColour(spriteFor({ form: s, stage: 1 })))
      const [lo, hi] = ranges[f]
      assert.ok(lo < hi ? h >= lo && h <= hi : h >= lo || h <= hi, `${s.id} main hue ${h}`)
    }
  }
  const span: Record<Family, [number, number]> = { haiku: [85, 165], sonnet: [190, 255], opus: [345, 400], fable: [260, 320] }
  const drawn = (f: Family) => Array.from({ length: 41 }, (_, i) => span[f][0] + (i / 40) * (span[f][1] - span[f][0])).flatMap(h => [bodyHue(f, h % 360), bodyHue(f, h % 360, true)])
  for (const a of FAMILIES) for (const b of FAMILIES) {
    if (a >= b) continue
    let min = 360
    for (const x of drawn(a)) for (const y of drawn(b)) min = Math.min(min, gap(x, y))
    assert.ok(min >= 35, `${a} and ${b} come within ${min.toFixed(1)} degrees`)
  }
  for (const f of FAMILIES) for (const h of drawn(f)) assert.ok(inHueRange(f, h), `${f} draws inside its range: ${h}`)
})

test("fusions draw with parent A's body, parent B's head-top and wings, B's colours on the head and A's below", () => {
  const sa = familySpecies(1, 'haiku')[0]!, sb = familySpecies(1, 'opus')[1]!
  const a = card(sa, {}, 1), b = card(sb, {}, 2)
  const h = { ...fuse(a, b, rngFromSeed('f'), NOW), id: 'h' } as Card
  const px = spriteFor(h)
  valid(px)
  connectedWithEyes(px, 'fusion')
  noBeads(px, 'fusion')
  const p = formParts(h.form!, 1, false)
  assert.equal(p.torso, sa.body)
  assert.equal(p.ears, partsFor(sb.id, sb.body).ears)
  assert.equal(p.wings, partsFor(sb.id, sb.body).wings)
  assert.equal(p.legs, partsFor(sa.id, sa.body).legs)
  const eyeRow = px.findIndex(r => r.some(isEye))
  const head = hueOf(mainColour(px.slice(0, eyeRow + 2))), body = hueOf(mainColour(px.slice(eyeRow + 4)))
  assert.ok(inHueRange('opus', head), `head in B's colours: ${head}`)
  assert.ok(inHueRange('haiku', body), `body in A's colours: ${body}`)
  assert.equal(getSpecies(h.form!.parents![0])!.family, 'haiku')
})

test('minis are 8x8 and keep the outline and two eyes, a cell apart on one row; they work on any pixels', () => {
  let marked = 0
  for (const season of [1, 2]) for (const s of seasonSpecies(season)) for (const stage of [1, 2, 3] as const) {
    const big = spriteFor({ ...card(s), stage })
    const m = miniSprite(big)
    valid(m, 8)
    assert.ok(opaque(m) >= 16)
    const eyes = m.flatMap((r, y) => r.flatMap((c, x) => (isEye(c) ? [[x, y] as const] : [])))
    assert.equal(eyes.length, 2, `${s.id} stage ${stage}: ${eyes.length} eyes`)
    assert.equal(eyes[0]![1], eyes[1]![1], `${s.id}: eyes on one row`)
    assert.ok(Math.abs(eyes[0]![0] - eyes[1]![0]) >= 2, `${s.id}: eyes apart`)
    // the eyes sit inside the face, never on its edge
    for (const [x, y] of eyes) assert.ok(m[y]![x - 1] !== -1 && m[y]![x + 1] !== -1, `${s.id}: eye at ${x},${y} inside the face`)
    // one of the big sprite's outline tones frames the whole mini, and it is lighter than the eyes
    const rims = new Set(m.flatMap((r, y) => r.filter((c, x) => c !== -1 && [m[y - 1]?.[x], m[y + 1]?.[x], r[x - 1], r[x + 1]].some(v => v === undefined || v === -1))))
    assert.equal(rims.size, 1, `${s.id}: one outline colour`)
    const outline = [...rims][0]!
    assert.ok(thinColours(big).has(outline) && lightness(outline) > lightness(EYE), `${s.id}: the mini's outline`)
    // the eyes sit under a row of face, not under the outline
    for (const [x, y] of eyes) assert.ok(m[y - 1]![x] !== outline, `${s.id}: eye at ${x},${y} below the face's top`)
    // ears and horns show as marks above the head
    const top = m.findIndex(r => r.some(c => c !== -1 && c !== outline))
    if (m[top]!.filter(c => c !== -1 && c !== outline).length < m[top + 1]!.filter(c => c !== -1 && c !== outline).length - 2) marked++
  }
  assert.ok(marked >= 30, `${marked} minis keep their ears`)
  valid(miniSprite(silhouette(spriteFor({ form: seasonSpecies(1)[0]! }))), 8)
  assert.equal(opaque(miniSprite(Array.from({ length: 16 }, () => Array(16).fill(-1)))), 0)
})

test('silhouette paints every opaque pixel one colour', () => {
  const px = spriteFor({ form: seasonSpecies(1)[5]! })
  const sil = silhouette(px, 0x123456)
  assert.equal(opaque(sil), opaque(px))
  assert.deepEqual(new Set(sil.flat().filter(c => c !== -1)), new Set([0x123456]))
})

test('faces: big eyes with a catchlight, and at most two near-white tones per creature', () => {
  for (let season = 1; season <= 6; season++) for (const s of seasonSpecies(season)) for (const stage of [1, 2, 3] as const) {
    const px = spriteFor({ form: s, stage })
    const eyes = px.flat().filter(isEye).length
    if (px.flat().includes(SHINE)) assert.ok(eyes >= 4, `${s.id}: an eye of ${eyes} pixels`)
    const whites = new Set(px.flat().filter(c => c !== -1 && lightness(c) > 0.86))
    assert.ok(whites.size <= 2, `${s.id} stage ${stage}: ${whites.size} near-white tones`)
  }
})

test('base64 matches the standard encoding', () => {
  const rng = rngFromSeed('b64')
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, () => Math.floor(rng() * 256))
    assert.equal(base64(bytes), Buffer.from(bytes).toString('base64'))
  }
})

test('toRaster packs 16x16 into 16 columns x 8 rows of half blocks', () => {
  const px = spriteFor({ form: seasonSpecies(1)[3]!, stage: 2 })
  const r = toRaster(px)
  assert.equal(r.columns, 16)
  assert.equal(r.rows, 8)
  const bytes = Buffer.from(r.cells, 'base64')
  assert.equal(bytes.length, 16 * 8 * 12)
  assert.equal(r.cells.length, Math.ceil((16 * 8 * 12) / 3) * 4)
  for (let row = 0; row < 8; row++) for (let col = 0; col < 16; col++) {
    const o = (row * 16 + col) * 12
    const [cp, fg, bg] = [bytes.readUInt32LE(o), bytes.readUInt32LE(o + 4), bytes.readUInt32LE(o + 8)]
    const top = px[2 * row]![col]!, bot = px[2 * row + 1]![col]!
    if (top === -1 && bot === -1) assert.deepEqual([cp, fg, bg], [0x20, 0x01000000, 0x01000000])
    else if (top === -1) assert.deepEqual([cp, fg, bg], [0x2584, bot, 0x01000000])
    else if (bot === -1) assert.deepEqual([cp, fg, bg], [0x2580, top, 0x01000000])
    else assert.deepEqual([cp, fg, bg], [0x2580, top, bot])
  }
  const mini = toRaster(miniSprite(px))
  assert.deepEqual([mini.columns, mini.rows, Buffer.from(mini.cells, 'base64').length], [8, 4, 8 * 4 * 12])
})

test('toSvg is crisp, scaled and only uses hex colours', () => {
  const px = spriteFor({ form: seasonSpecies(1)[20]!, stage: 1 })
  const svg = toSvg(px, 6)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16" width="96" height="96" shape-rendering="crispEdges">/)
  assert.ok(svg.endsWith('</svg>'))
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="#([0-9a-f]{6})"\/>/g)]
  assert.equal(rects.reduce((n, m) => n + Number(m[3]), 0), opaque(px))
  assert.equal(svg.replace(/<rect[^>]*\/>/g, '').replace(/<svg[^>]*>|<\/svg>/g, ''), '')
  assert.ok(svg.length < 131_072)
})

test('emoji mosaic: 8 lines of 8 squares from the allowed set', () => {
  const allowed = new Set(Object.values(MOSAIC))
  for (const s of seasonSpecies(1)) {
    const text = emojiMosaic(miniSprite(spriteFor({ form: s })))
    const lines = text.split('\n')
    assert.equal(lines.length, 8)
    for (const line of lines) {
      const cells = Array.from(line)
      assert.equal(cells.length, 8)
      for (const c of cells) assert.ok(allowed.has(c), c)
    }
  }
  assert.equal(emojiFor(-1), MOSAIC.white)
  assert.equal(emojiFor(0xd03030), MOSAIC.red)
  assert.equal(emojiFor(0xf09030), MOSAIC.orange)
  assert.equal(emojiFor(0xf0d040), MOSAIC.yellow)
  assert.equal(emojiFor(0x60b060), MOSAIC.green)
  assert.equal(emojiFor(0x5080e0), MOSAIC.blue)
  assert.equal(emojiFor(0x9060c0), MOSAIC.purple)
  assert.equal(emojiFor(0x704020), MOSAIC.brown)
  assert.equal(emojiFor(0x101010), MOSAIC.black)
  assert.equal(emojiFor(0xfafafa), MOSAIC.white)
  const greens = emojiMosaic(miniSprite(spriteFor({ form: familySpecies(1, 'haiku')[0]! })))
  assert.ok(greens.includes(MOSAIC.green) || greens.includes(MOSAIC.blue))
})

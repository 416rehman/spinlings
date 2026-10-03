// Renders a PNG contact sheet of creatures to .dev/sheet.png, so the art can be eyeballed.
// Usage: node scripts/sheet.ts [season] [out.png]
// Bands, top to bottom: the season at stages 1, 2 and 3 per family; 24 DNA variants of one species (8 per stage);
// 12 species from other seasons; 12 legendaries; 12 Mythics (final form only); raised forms (one species under each
// family, stages 2 and 3); minis at 2x; plain and shiny pairs; trinkets; foil (a static frame of the holo sweep);
// fusions on a light background.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Card, Family, Species } from '../plugin/hooks/core/types.ts'
import { FAMILIES } from '../plugin/hooks/core/families.ts'
import { familySpecies, seasonSpecies } from '../plugin/hooks/core/species.ts'
import { formLook, fuse, mintCard } from '../plugin/hooks/core/cards.ts'
import { mythicForm } from '../plugin/hooks/core/mythics.ts'
import { int, pick, rngFromSeed, uint32 } from '../plugin/hooks/core/rng.ts'
import { EYE, SHINE, draw, miniSprite, spriteFor } from '../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../plugin/hooks/core/sprite.ts'
import { seasonOf, seasonStart } from '../plugin/hooks/core/world.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const season = Number(process.argv[2] ?? seasonOf(Date.now()))
const outFile = resolve(process.argv[3] ?? resolve(root, '.dev/sheet.png'))
const now = seasonStart(season) + 3_600_000

const SCALE = 4, PAD = 2, CELL = (16 + PAD * 2) * SCALE, COLS = 12
const DARK = 0x1b1d24, LIGHT = 0xefece4, LABEL = 0x3a3f4d, MYTH = 0x231a2e, RAISE = 0x1d2621

type Item = { px: Pixels; bg?: number; mini?: boolean; foil?: boolean } | null
const rows: { items: Item[]; bg: number }[] = []
const row = (items: Item[], bg = DARK) => rows.push({ items, bg })

const card = (s: Species, dna: number, extra: Partial<Card> = {}): Card => ({
  ...mintCard({ species: s, rarity: s.legendary ? 'legendary' : 'common', shiny: false, dna, origin: 'pack', now }),
  id: 'x', ...extra,
})
const rng = rngFromSeed('sheet/' + season)

// 1. the season: per family, stages 1, 2 and 3 (legendaries are always in their final form)
type Stage = 1 | 2 | 3
const STAGES: Stage[] = [1, 2, 3]
for (const f of FAMILIES) {
  const list = familySpecies(season, f)
  for (const stage of STAGES) row(list.map(s => ({ px: spriteFor({ form: s, stage }) })))
}

// 2. 24 DNA variants of one species, 8 per stage
const one = familySpecies(season, 'haiku')[int(rng, 8)]!
const variants = Array.from({ length: 24 }, (_, i) => ({ px: spriteFor({ ...card(one, uint32(rng)), stage: STAGES[Math.floor(i / 8)]! }) }))
row(variants.slice(0, 12))
row(variants.slice(12))

// 3. 12 species from other seasons for breadth, at each stage
const extra = Array.from({ length: 12 }, (_, i) => seasonSpecies(season + 1 + i)[int(rng, 36)]!)
for (const stage of STAGES) row(extra.map(s => ({ px: spriteFor({ form: s, stage }) })))

// 4. 12 legendaries from this and the following seasons, then 12 Mythics: one of a kind and never evolving
row(Array.from({ length: COLS }, (_, i) => ({ px: spriteFor({ form: familySpecies(season + i, FAMILIES[i % 4]!)[8]! }) })))
const mythics = Array.from({ length: COLS }, (_, i) => mythicForm(`sheet-${season}-${i}`))
row(mythics.map(m => ({ px: spriteFor({ form: m }) })), MYTH)

// 5. raised forms: one species per row, stage 1, then stages 2 and 3 under each raising family (home first)
for (const f of ['sonnet', 'opus'] as Family[]) {
  const s = familySpecies(season, f)[int(rng, 8)]!
  const order = [f, ...FAMILIES.filter(x => x !== f)]
  row([{ px: spriteFor({ form: s, stage: 1 }) }, null, ...order.flatMap(r => ([2, 3] as const).map(stage => ({ px: spriteFor({ form: s, stage, raisedIn: r }), bg: r === f ? DARK : RAISE })))], RAISE)
}

// 6. minis at 2x: the haiku and opus families at stage 1, plus stages 2 and 3 of the first two
for (const f of ['haiku', 'opus'] as Family[]) {
  const list = familySpecies(season, f)
  row([...list.map(s => ({ px: miniSprite(spriteFor({ form: s, stage: 1 })), mini: true })), null, ...list.slice(0, 2).map(s => ({ px: miniSprite(spriteFor({ form: s, stage: 3 })), mini: true }))])
}
row(mythics.map(m => ({ px: miniSprite(spriteFor({ form: m })), mini: true })), MYTH)

// 7. plain and shiny pairs, trinkets at stages 1 and 3, foil (a static frame of the holo sweep), then fusions:
// parent A, parent B, hybrid
const all = seasonSpecies(season)
row(Array.from({ length: COLS / 2 }, () => {
  const c = card(pick(rng, all), uint32(rng)), stage = pick(rng, STAGES)
  return [{ px: spriteFor({ ...c, stage }) }, { px: spriteFor({ ...c, shiny: true, stage }) }]
}).flat())
row((['hat', 'bow', 'flower', 'scarf', 'monocle', 'hat'] as const).flatMap((trinket, i) => ([1, 3] as const).map(stage => {
  const s = all[(i * 7 + stage) % all.length]!
  return { px: draw(s, { ...formLook(s), trinket }, stage, s.legendary) }
})))
row(Array.from({ length: COLS }, () => ({ px: spriteFor({ ...card(pick(rng, all), uint32(rng)), stage: pick(rng, STAGES) }), foil: true })))
const fusions: Item[] = []
for (let i = 0; i < 4; i++) {
  const a = card(pick(rng, all), uint32(rng), { level: 3 })
  const b = card(pick(rng, all), uint32(rng), { level: 6, stage: 2 })
  const h = { ...fuse(a, b, rng, now), id: 'h' } as Card
  fusions.push({ px: spriteFor(a) }, { px: spriteFor(b) }, { px: spriteFor(h), bg: 0x2a2433 })
}
row(fusions, LIGHT)

// ---------- raster to PNG ----------
const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
const lightness = (c: number) => (Math.max(c >> 16, (c >> 8) & 255, c & 255) + Math.min(c >> 16, (c >> 8) & 255, c & 255)) / 510
/** colours that mostly touch the open air: the outline and its kin, which the holo band leaves alone */
const thinColours = (px: Pixels) => {
  const edge = new Map<number, number>(), count = new Map<number, number>()
  px.forEach((r, y) => r.forEach((c, x) => {
    if (c < 0) return
    count.set(c, (count.get(c) ?? 0) + 1)
    if ([px[y - 1]?.[x], px[y + 1]?.[x], r[x - 1], r[x + 1]].some(v => v === undefined || v < 0)) edge.set(c, (edge.get(c) ?? 0) + 1)
  }))
  return new Set([...edge].filter(([c, n]) => n >= 0.6 * count.get(c)!).map(([c]) => c))
}
const rainbow = (x: number, y: number) => (x * 18 + y * 10) % 360
const mix = (a: number, [r, g, b]: [number, number, number], t: number) => {
  const ch = (v: number, w: number) => Math.round(v * (1 - t) + w * 255 * t)
  return (ch(a >> 16, r) << 16) | (ch((a >> 8) & 255, g) << 8) | ch(a & 255, b)
}

const W = COLS * CELL, H = rows.length * CELL
const img = new Uint8Array(W * H * 3)
const fill = (x0: number, y0: number, w: number, h: number, c: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * W + x) * 3
    img[o] = (c >> 16) & 255; img[o + 1] = (c >> 8) & 255; img[o + 2] = c & 255
  }
}
fill(0, 0, W, H, LABEL)
rows.forEach(({ items, bg }, r) => items.forEach((it, c) => {
  if (!it) return
  const x0 = c * CELL, y0 = r * CELL
  fill(x0 + 1, y0 + 1, CELL - 2, CELL - 2, it.bg ?? bg)
  if (it.foil) for (let i = 0; i < CELL - 2; i++) {
    const [cr, cg, cb] = hsl((i * 9) % 360, 0.7, 0.6), col = (Math.round(cr * 255) << 16) | (Math.round(cg * 255) << 8) | Math.round(cb * 255)
    fill(x0 + 1 + i, y0 + 1, 1, 2, col); fill(x0 + 1 + i, y0 + CELL - 3, 1, 2, col)
    fill(x0 + 1, y0 + 1 + i, 2, 1, col); fill(x0 + CELL - 3, y0 + 1 + i, 2, 1, col)
  }
  const n = it.px.length, sc = it.mini ? SCALE * 2 : SCALE
  const thin = it.foil ? thinColours(it.px) : new Set<number>()
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let col = it.px[y]?.[x] ?? -1
    if (col < 0) continue
    // a narrow sheen that keeps each pixel's lightness and never crosses the eyes or the outline
    const keep = col === EYE || col === SHINE || thin.has(col)
    if (it.foil && !keep && Math.abs(x + y - 15) <= 1) col = mix(col, hsl(rainbow(x, y), 0.9, lightness(col)), 0.28)
    fill(x0 + PAD * SCALE + x * sc, y0 + PAD * SCALE + y * sc, sc, sc, col)
  }
}))

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Uint8Array) => {
  let c = ~0
  for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8)
  return ~c >>> 0
}
const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1)
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array()),
]))
console.log(`season ${season}: ${W}x${H} -> ${outFile}`)

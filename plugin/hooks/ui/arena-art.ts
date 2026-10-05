// The duel's static, local pixel worlds. Family and the authoritative day rule choose only their look.
// The first 40 px stay quiet for the HUD; foreground creatures and their timelines belong to the caller.
import type { DailyRule, Family } from '../core/types.ts'

export type ArenaTheme = {
  name: string
  sky: string
  far: string
  middle: string
  ground: string
  edge: string
  accent: string
  glow: string
}

const THEMES: Record<Family, ArenaTheme> = {
  haiku: { name: 'Moss Grove', sky: '#102522', far: '#183b33', middle: '#245447', ground: '#132f2b', edge: '#407b5c', accent: '#83d4aa', glow: '#c5e5a8' },
  sonnet: { name: 'Moonlit Water', sky: '#141f37', far: '#223552', middle: '#344c70', ground: '#1a2b44', edge: '#547fac', accent: '#9fc9ef', glow: '#d9e4f5' },
  opus: { name: 'Ember Cliffs', sky: '#2b1a23', far: '#542931', middle: '#7a3b37', ground: '#352127', edge: '#a26047', accent: '#f7a675', glow: '#f7d391' },
  fable: { name: 'Floating Isles', sky: '#201c38', far: '#393053', middle: '#57426e', ground: '#2d2542', edge: '#80629b', accent: '#c5a0ef', glow: '#e1c9f3' },
}

export const arenaTheme = (arena: Family): ArenaTheme => THEMES[arena]

// All landscape coordinates snap to a two-pixel grid. Empty pieces disappear rather than drawing negative sizes.
const snap = (v: number) => Math.round(v / 2) * 2
type Point = readonly [number, number]
type Paint = {
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void
  path: (points: readonly Point[], color: string, opacity?: number) => void
  finish: () => string
}

function painter(): Paint {
  const pieces: string[] = []
  const alpha = (opacity: number) => opacity === 1 ? '' : ` opacity="${opacity}"`
  return {
    rect(x, y, w, h, color, opacity = 1) {
      const width = snap(w), height = snap(h)
      if (width > 0 && height > 0) pieces.push(`<rect x="${snap(x)}" y="${snap(y)}" width="${width}" height="${height}" fill="${color}"${alpha(opacity)}/>`)
    },
    path(points, color, opacity = 1) {
      const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${snap(x)} ${snap(y)}`).join('')
      pieces.push(`<path d="${d}Z" fill="${color}"${alpha(opacity)}/>`)
    },
    finish: () => pieces.join(''),
  }
}

function glint(p: Paint, x: number, y: number, color: string, opacity = 0.6): void {
  p.rect(x, y - 4, 2, 2, color, opacity)
  p.rect(x, y + 4, 2, 2, color, opacity)
  p.rect(x - 4, y, 2, 2, color, opacity)
  p.rect(x + 4, y, 2, 2, color, opacity)
}

/** Stepped foliage, with deliberately placed leaf clusters instead of texture noise. */
function canopy(p: Paint, x: number, y: number, w: number, h: number, dark: string, light: string): void {
  p.path([[x + 10, y], [x + w - 12, y], [x + w - 12, y + 4], [x + w - 4, y + 4], [x + w - 4, y + 10], [x + w, y + 10],
    [x + w, y + h - 6], [x + w - 8, y + h - 6], [x + w - 8, y + h], [x + 8, y + h], [x + 8, y + h - 4],
    [x, y + h - 4], [x, y + 8], [x + 6, y + 8], [x + 6, y + 4], [x + 10, y + 4]], dark)
  p.rect(x + 12, y + 2, w * 0.28, 2, light, 0.45)
  p.rect(x + w * 0.56, y + 6, w * 0.2, 2, light, 0.3)
  p.rect(x + 6, y + h * 0.5, 6, 4, light, 0.3)
  p.rect(x + w * 0.34, y + h - 6, 8, 2, light, 0.2)
}

function tree(p: Paint, x: number, floor: number, h: number, t: ArenaTheme, distant = false): void {
  const y = floor - h, width = distant ? 26 : 44
  const trunk = distant ? t.far : '#27473b', leaf = distant ? t.far : t.middle
  p.path([[x + width * 0.45, y + 20], [x + width * 0.62, y + 20], [x + width * 0.62, floor - 12],
    [x + width * 0.76, floor - 12], [x + width * 0.76, floor], [x + width * 0.28, floor],
    [x + width * 0.28, floor - 6], [x + width * 0.42, floor - 6]], trunk)
  p.rect(x + width * 0.56, y + 34, 2, h - 42, distant ? t.middle : t.edge, 0.5)
  p.path([[x + width * 0.48, y + 42], [x + 8, y + 32], [x + 8, y + 26], [x + width * 0.52, y + 36]], trunk)
  canopy(p, x - 8, y + 14, width + 10, 20, leaf, distant ? t.middle : t.edge)
  canopy(p, x + 4, y, width - 4, 24, leaf, distant ? t.middle : t.edge)
  if (!distant) canopy(p, x + 18, y + 22, width - 6, 16, leaf, t.edge)
}

/** Broad, low stone stages read as part of the world; their tops align with the fighters' feet. */
function platform(p: Paint, center: number, floor: number, width: number, arena: Family, t: ArenaTheme): void {
  const x = center - width / 2
  p.path([[x + 12, floor], [x + width - 12, floor], [x + width - 12, floor + 4], [x + width, floor + 4],
    [x + width, floor + 10], [x + width - 8, floor + 10], [x + width - 8, floor + 16],
    [x + width - 24, floor + 16], [x + width - 24, floor + 22], [x + 22, floor + 22],
    [x + 22, floor + 16], [x + 8, floor + 16], [x + 8, floor + 10], [x, floor + 10], [x, floor + 4], [x + 12, floor + 4]], t.ground)
  p.rect(x + 12, floor, width - 24, 4, t.edge)
  p.rect(x + 20, floor, width * 0.31, 2, t.accent, 0.5)
  p.rect(x + width * 0.57, floor + 4, width * 0.23, 4, t.middle)
  p.rect(x + 8, floor + 8, width * 0.28, 4, t.middle)
  p.rect(x + width * 0.37, floor + 12, width * 0.27, 4, t.middle)
  p.rect(x + width * 0.19, floor + 4, 2, 6, t.ground)
  p.rect(x + width * 0.66, floor + 8, 2, 8, t.ground)
  p.rect(x + width * 0.66, floor + 14, 8, 2, t.ground)
  if (arena === 'haiku') {
    p.rect(x + 6, floor - 2, 16, 4, '#49764d')
    p.rect(x + width - 32, floor - 2, 22, 4, '#49764d')
    p.rect(x + width - 18, floor + 2, 2, 8, '#49764d')
    p.rect(x + 14, floor + 4, 2, 6, '#49764d')
  } else if (arena === 'opus') {
    p.rect(x + width * 0.44, floor + 4, 2, 10, '#dd8055', 0.6)
    p.rect(x + width * 0.44, floor + 12, 10, 2, '#dd8055', 0.6)
  } else if (arena === 'fable') {
    p.rect(x + width * 0.48, floor + 20, width * 0.13, 4, t.far)
    p.rect(x + width * 0.51, floor + 24, width * 0.06, 4, t.far)
    p.rect(x + 12, floor + 6, 2, 4, t.glow, 0.45)
  } else {
    p.rect(x + 18, floor + 6, 12, 2, t.accent, 0.2)
    p.rect(x + width - 40, floor + 12, 18, 2, t.accent, 0.15)
  }
}

function grove(p: Paint, w: number, h: number, t: ArenaTheme): void {
  const horizon = snap(h * 0.59), floor = snap(h * 0.88)
  p.path([[0, horizon - 8], [w * 0.13, horizon - 8], [w * 0.13, horizon - 4], [w * 0.33, horizon - 4],
    [w * 0.33, horizon + 2], [w * 0.57, horizon + 2], [w * 0.57, horizon - 4], [w * 0.83, horizon - 4],
    [w * 0.83, horizon - 10], [w, horizon - 10], [w, h], [0, h]], t.far)
  for (const [x, height] of [[w * 0.1, 28], [w * 0.35, 24], [w * 0.62, 22], [w * 0.86, 30]] as const) tree(p, x, horizon + 6, height, t, true)
  p.rect(0, horizon + 12, w, h - horizon - 12, '#17352f')
  p.rect(w * 0.34, horizon + 14, w * 0.32, h - horizon - 14, '#204741')
  p.rect(w * 0.41, horizon + 20, w * 0.21, 2, '#447364', 0.45)
  p.rect(w * 0.46, horizon + 26, w * 0.09, 2, '#70a592', 0.3)
  p.rect(w * 0.39, horizon + 32, w * 0.17, 2, '#447364', 0.4)
  p.rect(w * 0.53, horizon + 38, w * 0.1, 2, '#70a592', 0.2)
  tree(p, -8, floor, Math.min(70, floor - 44), t)
  tree(p, w - 50, floor, Math.min(66, floor - 44), t)
  tree(p, w * 0.1, floor + 2, Math.min(52, floor - 44), t)
  for (const x of [w * 0.33, w * 0.65, w - 14]) {
    p.rect(x, floor - 10, 2, 12, t.edge)
    p.rect(x + 4, floor - 16, 2, 18, t.middle)
    p.rect(x + 4, floor - 18, 2, 4, t.glow, 0.5)
    p.rect(x - 4, floor - 6, 6, 2, t.edge)
  }
  for (const [x, y] of [[w * 0.15, h - 6], [w * 0.36, h - 4], [w * 0.64, h - 6], [w * 0.89, h - 8]] as const) {
    p.rect(x, y, 14, 2, t.middle)
    p.rect(x + 4, y - 2, 4, 2, t.edge)
  }
}

/** Broken moonstone arches retain masonry joints, capstones and soft reflections. */
function arch(p: Paint, x: number, floor: number, t: ArenaTheme): void {
  p.path([[x + 6, floor - 34], [x + 6, floor - 42], [x + 16, floor - 42], [x + 16, floor - 48],
    [x + 34, floor - 48], [x + 34, floor - 42], [x + 44, floor - 42], [x + 44, floor - 30],
    [x + 50, floor - 30], [x + 50, floor], [x + 38, floor], [x + 38, floor - 28], [x + 32, floor - 28],
    [x + 32, floor - 36], [x + 18, floor - 36], [x + 18, floor - 28], [x + 12, floor - 28], [x + 12, floor],
    [x, floor], [x, floor - 34]], t.middle)
  p.rect(x + 18, floor - 48, 14, 2, t.edge)
  p.rect(x + 2, floor - 32, 2, 28, t.edge, 0.6)
  p.rect(x + 40, floor - 28, 2, 24, t.edge, 0.45)
  p.rect(x, floor - 18, 12, 2, t.far)
  p.rect(x + 38, floor - 10, 12, 2, t.far)
  p.rect(x + 26, floor - 46, 2, 8, t.far)
  p.rect(x - 4, floor, 20, 4, t.far)
  p.rect(x + 34, floor, 20, 4, t.far)
}

function moonlit(p: Paint, w: number, h: number, t: ArenaTheme): void {
  const horizon = snap(h * 0.62), floor = snap(h * 0.88), moonX = snap(w * 0.5)
  p.rect(moonX - 12, 46, 22, 12, t.glow, 0.32)
  p.rect(moonX - 8, 42, 14, 20, t.glow, 0.32)
  p.rect(moonX, 42, 12, 14, t.sky)
  p.path([[0, horizon - 8], [w * 0.13, horizon - 8], [w * 0.13, horizon - 2], [w * 0.37, horizon - 2],
    [w * 0.37, horizon + 4], [w * 0.67, horizon + 4], [w * 0.67, horizon - 2], [w * 0.84, horizon - 2],
    [w * 0.84, horizon - 10], [w, horizon - 10], [w, h], [0, h]], t.far)
  p.rect(0, horizon + 6, w, h - horizon - 6, '#1c344b')
  for (const [x, y, width] of [[w * 0.45, horizon + 8, w * 0.1], [w * 0.48, horizon + 14, w * 0.05],
    [w * 0.41, horizon + 22, w * 0.16], [w * 0.46, horizon + 30, w * 0.1]] as const) p.rect(x, y, width, 2, t.glow, 0.16)
  for (let i = 0; i < 8; i++) {
    const x = w * (0.07 + i * 0.115), y = horizon + 12 + (i % 3) * 8
    p.rect(x, y, 18 + (i % 3) * 8, 2, t.edge, 0.4)
    p.rect(x + 8, y + 4, 12, 2, t.edge, 0.2)
  }
  arch(p, w * 0.035, floor - 2, t)
  arch(p, w * 0.94 - 50, floor - 4, t)
  p.rect(w * 0.12, floor - 22, 12, 24, t.far)
  p.rect(w * 0.12 - 2, floor - 24, 16, 4, t.middle)
  p.rect(w * 0.12 + 2, floor - 18, 2, 14, t.edge, 0.3)
  for (const x of [w * 0.03, w * 0.36, w * 0.86]) {
    p.rect(x, floor + 6, 2, 12, t.middle)
    p.rect(x - 4, floor + 8, 6, 2, t.middle)
    p.rect(x + 2, floor + 4, 6, 2, t.edge, 0.6)
  }
}

function cliffs(p: Paint, w: number, h: number, t: ArenaTheme): void {
  const horizon = snap(h * 0.59), floor = snap(h * 0.88)
  p.rect(0, horizon - 16, w, 10, '#45252e', 0.6)
  p.rect(w * 0.3, horizon - 8, w * 0.4, 10, '#6a3635', 0.45)
  p.rect(w * 0.42, horizon - 4, w * 0.16, 2, t.accent, 0.3)
  p.path([[0, horizon - 12], [w * 0.08, horizon - 12], [w * 0.08, 46], [w * 0.14, 46], [w * 0.14, horizon - 6],
    [w * 0.23, horizon - 6], [w * 0.23, horizon + 14], [w * 0.72, horizon + 14], [w * 0.72, horizon - 4],
    [w * 0.82, horizon - 4], [w * 0.82, 44], [w * 0.9, 44], [w * 0.9, horizon - 10], [w, horizon - 10], [w, h], [0, h]], t.far)
  p.path([[0, horizon + 8], [w * 0.09, horizon + 8], [w * 0.09, horizon + 18], [w * 0.15, horizon + 18],
    [w * 0.15, floor + 8], [w * 0.83, floor + 8], [w * 0.83, horizon + 18], [w * 0.9, horizon + 18],
    [w * 0.9, horizon + 4], [w, horizon + 4], [w, h], [0, h]], t.middle)
  for (const [x, y, width] of [[0, horizon + 10, w * 0.08], [w * 0.035, horizon + 28, w * 0.075],
    [w * 0.91, horizon + 10, w * 0.09], [w * 0.86, horizon + 28, w * 0.1], [w * 0.94, floor + 8, w * 0.06]] as const) {
    p.rect(x, y, width, 2, t.edge)
    p.rect(x + 8, y + 6, width * 0.6, 2, t.far, 0.7)
  }
  // A thin river of embers stays beneath the combat stage, never between the health readouts.
  p.rect(w * 0.34, h - 8, w * 0.31, 8, '#7d3d36')
  p.rect(w * 0.41, h - 6, w * 0.13, 2, '#d67c4c', 0.6)
  p.rect(w * 0.53, h - 2, w * 0.08, 2, '#f7b56b', 0.6)
  for (const [x, y] of [[w * 0.34, horizon + 10], [w * 0.63, horizon + 26], [w * 0.71, horizon + 4], [w * 0.45, floor - 6]] as const) {
    p.rect(x, y, 2, 2, t.glow, 0.55)
    p.rect(x + 4, y - 6, 2, 2, t.accent, 0.25)
  }
}

function island(p: Paint, x: number, y: number, width: number, t: ArenaTheme): void {
  p.path([[x + 6, y], [x + width - 6, y], [x + width - 6, y + 4], [x + width, y + 4], [x + width, y + 10],
    [x + width - 8, y + 10], [x + width - 8, y + 16], [x + width - 16, y + 16], [x + width - 16, y + 22],
    [x + 18, y + 22], [x + 18, y + 16], [x + 8, y + 16], [x + 8, y + 10], [x, y + 10], [x, y + 4], [x + 6, y + 4]], t.middle)
  p.rect(x + 6, y, width - 12, 2, t.edge)
  p.rect(x + width * 0.48, y + 20, 6, 8, t.far)
  p.rect(x + width * 0.33, y + 8, 8, 2, t.far)
  p.rect(x + 10, y - 2, 8, 2, t.accent, 0.4)
}

function isles(p: Paint, w: number, h: number, t: ArenaTheme): void {
  const horizon = snap(h * 0.59), floor = snap(h * 0.88)
  p.rect(0, horizon + 6, w, h - horizon - 6, t.far, 0.35)
  p.rect(w * 0.34, horizon + 14, w * 0.32, 6, t.middle, 0.25)
  p.rect(w * 0.29, horizon + 24, w * 0.45, 4, t.middle, 0.22)
  p.rect(w * 0.37, horizon + 36, w * 0.25, 2, t.edge, 0.2)
  island(p, w * 0.04, horizon - 14, Math.min(70, w * 0.12), t)
  island(p, w * 0.86, horizon - 22, Math.min(80, w * 0.13), t)
  island(p, w * 0.47, horizon + 10, Math.min(36, w * 0.06), { ...t, middle: t.far, edge: t.middle })
  // A small ancient pillar and a crystalline sapling give the far islands their own silhouettes.
  p.rect(w * 0.07, horizon - 30, 8, 16, t.middle)
  p.rect(w * 0.07 - 2, horizon - 32, 12, 4, t.edge)
  p.rect(w * 0.07 + 2, horizon - 26, 2, 10, t.accent, 0.35)
  const sx = w * 0.9, sy = Math.max(40, horizon - 46)
  p.rect(sx, sy + 6, 4, horizon - 28 - sy, t.edge)
  p.path([[sx - 8, sy + 10], [sx - 8, sy + 4], [sx - 2, sy + 4], [sx - 2, sy],
    [sx + 4, sy], [sx + 4, sy + 4], [sx + 10, sy + 4], [sx + 10, sy + 10]], t.middle)
  p.rect(sx - 2, sy + 2, 4, 2, t.accent, 0.6)
  for (const [x, y] of [[w * 0.16, 48], [w * 0.68, 52], [w * 0.79, 44], [w * 0.39, 66]] as const) glint(p, x, y, t.glow, 0.35)
  p.rect(w * 0.065, floor + 4, 8, 4, t.middle)
  p.rect(w * 0.92, floor + 8, 6, 4, t.middle)
}

function dayAccent(p: Paint, rule: DailyRule, w: number, h: number, t: ArenaTheme): void {
  const floor = snap(h * 0.88)
  if (rule === 'glassDay') {
    glint(p, w * 0.38, h * 0.67, '#d6f0ee', 0.65)
    glint(p, w * 0.66, h * 0.75, '#d6f0ee', 0.45)
  } else if (rule === 'longDay') p.rect(w * 0.3, h * 0.59, w * 0.4, 2, '#f4b77b', 0.25)
  else if (rule === 'wildBloom') {
    for (const [x, color] of [[w * 0.13, '#f0b6cf'], [w * 0.34, '#f4d695'], [w * 0.67, '#f0b6cf'], [w * 0.88, '#f4d695']] as const) {
      p.rect(x + 2, floor - 4, 2, 6, t.edge)
      p.rect(x, floor - 6, 6, 2, color, 0.8)
      p.rect(x + 2, floor - 8, 2, 6, color, 0.8)
    }
  } else {
    const family: Family | null = rule === 'haikuDay' ? 'haiku' : rule === 'sonnetDay' ? 'sonnet' : rule === 'opusDay' ? 'opus' : rule === 'fableDay' ? 'fable' : null
    if (family) {
      const color = THEMES[family].accent
      p.rect(w * 0.41, h * 0.61, w * 0.18, 2, color, 0.35)
      p.rect(w * 0.47, h * 0.61 + 6, w * 0.06, 2, color, 0.2)
    }
  }
}

/** SVG fragment without a wrapper; the caller owns clipping, accessibility and foreground fighters. */
export function arenaBackdrop(arena: Family, rule: DailyRule, w: number, height: number): string {
  const t = arenaTheme(arena), p = painter()
  p.rect(0, 0, w, height, t.sky)
  p.rect(0, 40, w, height - 40, t.far, 0.16)
  if (arena === 'haiku') grove(p, w, height, t)
  else if (arena === 'sonnet') moonlit(p, w, height, t)
  else if (arena === 'opus') cliffs(p, w, height, t)
  else isles(p, w, height, t)
  const floor = snap(height * 0.88), width = Math.min(144, w * 0.27)
  platform(p, w * 0.23, floor, width, arena, t)
  platform(p, w * 0.77, floor, width, arena, t)
  dayAccent(p, rule, w, height, t)
  return `<g shape-rendering="crispEdges">${p.finish()}</g>`
}

// Local painted worlds for the shared stage. Scenery never reads work, fetches assets or decides combat.
import type { DailyRule, Family } from '../core/types.ts'
import { ARENA_PNG } from './arena-art-data.ts'

export type ArenaTheme = {
  name: string; sky: string; far: string; middle: string; ground: string; edge: string; accent: string; glow: string
}

const THEMES: Record<Family, ArenaTheme> = {
  haiku: { name: 'Moss Grove', sky: '#102522', far: '#1d4039', middle: '#345c46', ground: '#152b29', edge: '#659564', accent: '#b1daa1', glow: '#e9e9b5' },
  sonnet: { name: 'Moonlit Water', sky: '#141f37', far: '#263c57', middle: '#45617b', ground: '#1c2d42', edge: '#8aa7b8', accent: '#bad9e5', glow: '#edf3f4' },
  opus: { name: 'Ember Cliffs', sky: '#2b1a23', far: '#55353c', middle: '#81513f', ground: '#2d252e', edge: '#c88252', accent: '#ffc98b', glow: '#fff0bb' },
  fable: { name: 'Floating Isles', sky: '#201c38', far: '#3d365a', middle: '#69618b', ground: '#342b48', edge: '#a99abd', accent: '#dec3f1', glow: '#f5e1fb' },
}
export const arenaTheme = (arena: Family): ArenaTheme => THEMES[arena]

const snap = (v: number) => Math.round(v / 2) * 2
type Point = readonly [number, number]
type Paint = {
  rect: (x: number, y: number, w: number, h: number, color: string, opacity?: number) => void
  path: (points: readonly Point[], color: string, opacity?: number) => void
  finish: () => string
}
function painter(): Paint {
  const pieces: string[] = []
  const alpha = (v: number) => v === 1 ? '' : ` opacity="${v}"`
  return {
    rect(x, y, w, h, color, opacity = 1) {
      if (snap(w) > 0 && snap(h) > 0) pieces.push(`<rect x="${snap(x)}" y="${snap(y)}" width="${snap(w)}" height="${snap(h)}" fill="${color}"${alpha(opacity)}/>`)
    },
    path(points, color, opacity = 1) {
      pieces.push(`<path d="${points.map(([x, y], i) => `${i ? 'L' : 'M'}${snap(x)} ${snap(y)}`).join('')}Z" fill="${color}"${alpha(opacity)}/>`)
    },
    finish: () => pieces.join(''),
  }
}

function glint(p: Paint, x: number, y: number, c: string, opacity = 0.7): void {
  p.rect(x, y - 4, 2, 2, c, opacity); p.rect(x, y + 4, 2, 2, c, opacity)
  p.rect(x - 4, y, 2, 2, c, opacity); p.rect(x + 4, y, 2, 2, c, opacity)
}

const STAGE: Record<Family, { leftX: number; rightX: number; topY: number }> = {
  haiku: { leftX: 248 / 800, rightX: 560 / 800, topY: 115.5 / 144 },
  sonnet: { leftX: 246 / 800, rightX: 560 / 800, topY: 116.5 / 144 },
  opus: { leftX: 246 / 800, rightX: 560 / 800, topY: 116.5 / 144 },
  fable: { leftX: 246 / 800, rightX: 560 / 800, topY: 117.5 / 144 },
}
const n = (v: number) => Math.round(v * 1000) / 1000

export function arenaCameraLayout(family: Family, width: number, height = 144) {
  const stage = STAGE[family], floor = Math.round(height * 0.88 / 2) * 2
  const bgWidth = Math.max(width, 768), bgHeight = bgWidth * 90 / 480
  const ownCenter = Math.round(width * 0.3 / 2) * 2, foeCenter = Math.round(width * 0.7 / 2) * 2
  return {
    width, height, floor, bgWidth, bgHeight, yOffset: n(floor - stage.topY * bgHeight),
    baseX: n((width - bgWidth) / 2), leftX: n(ownCenter - stage.leftX * bgWidth), rightX: n(foeCenter - stage.rightX * bgWidth),
    ownCenter, foeCenter, paintedTopNormalized: stage.topY, paintedLeftNormalized: stage.leftX, paintedRightNormalized: stage.rightX,
    maskedViews: width < 768,
  }
}

function cameraFragment(family: Family, pngDataUri: string, width: number, height = 144): string {
  const o = arenaCameraLayout(family, width, height)
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(pngDataUri)) throw new Error('A local encoded PNG is required')
  const gradients = o.maskedViews ? `<linearGradient id="arena-camera-left-gradient" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="white"/><stop offset="0.38" stop-color="white"/><stop offset="0.52" stop-color="black"/><stop offset="1" stop-color="black"/></linearGradient><linearGradient id="arena-camera-right-gradient" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="black"/><stop offset="0.48" stop-color="black"/><stop offset="0.62" stop-color="white"/><stop offset="1" stop-color="white"/></linearGradient><mask id="arena-camera-left-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="url(#arena-camera-left-gradient)"/></mask><mask id="arena-camera-right-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="url(#arena-camera-right-gradient)"/></mask>` : ''
  const defs = `<defs><image id="arena-paint" width="${o.bgWidth}" height="${n(o.bgHeight)}" href="${pngDataUri}" style="image-rendering:pixelated"/>${gradients}</defs>`
  const base = `<rect width="${width}" height="${height}" fill="${THEMES[family].sky}"/><use href="#arena-paint" x="${o.baseX}" y="${o.yOffset}"/>`
  const views = o.maskedViews ? `<g mask="url(#arena-camera-left-mask)"><use href="#arena-paint" x="${o.leftX}" y="${o.yOffset}"/></g><g mask="url(#arena-camera-right-mask)"><use href="#arena-paint" x="${o.rightX}" y="${o.yOffset}"/></g>` : ''
  return defs + base + views
}

function dayAccent(p: Paint, rule: DailyRule, w: number, h: number, t: ArenaTheme): void {
  const floor = snap(h * 0.88)
  if (rule === 'glassDay') {
    glint(p, w * 0.36, floor - 20, '#e1eee4', 0.6); glint(p, w * 0.66, floor - 14, '#e1eee4', 0.45)
  } else if (rule === 'wildBloom') {
    for (const [x, c] of [[w * 0.15, '#dcb5cf'], [w * 0.86, '#e6cf9e']] as const) {
      p.rect(x, floor + 2, 2, 6, t.edge); p.rect(x - 2, floor, 6, 2, c); p.rect(x, floor - 2, 2, 6, c)
    }
  } else if (rule === 'longDay') p.rect(w * 0.43, 90, w * 0.12, 2, '#e0b988', 0.3)
  else {
    const family = rule === 'haikuDay' ? 'haiku' : rule === 'sonnetDay' ? 'sonnet' : rule === 'opusDay' ? 'opus' : rule === 'fableDay' ? 'fable' : null
    if (family) glint(p, w * 0.61, floor - 6, THEMES[family].accent, 0.4)
  }
}


/** One trusted PNG, local camera references and cosmetic rule accents. The scene owns its clip and timeline. */
export function arenaBackdrop(arena: Family, rule: DailyRule, w: number, height: number): string {
  const p = painter()
  dayAccent(p, rule, w, height, arenaTheme(arena))
  return `<g clip-path="url(#arena-clip)">${cameraFragment(arena, ARENA_PNG[arena], w, height)}<g shape-rendering="crispEdges">${p.finish()}</g></g>`
}

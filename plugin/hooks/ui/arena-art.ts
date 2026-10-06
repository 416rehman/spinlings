// Local chunky pixel worlds for the shared stage. Scenery never reads work, fetches assets or decides combat.
import type { DailyRule, Family } from '../core/types.ts'
import { ARENA_PNG } from './arena-art-data.ts'

export type ArenaTheme = {
  sky: string; far: string; middle: string; ground: string; edge: string; accent: string; glow: string
}

const THEMES: Record<Family, ArenaTheme> = {
  haiku: { sky: '#102522', far: '#1d4039', middle: '#345c46', ground: '#152b29', edge: '#659564', accent: '#b1daa1', glow: '#e9e9b5' },
  sonnet: { sky: '#141f37', far: '#263c57', middle: '#45617b', ground: '#1c2d42', edge: '#8aa7b8', accent: '#bad9e5', glow: '#edf3f4' },
  opus: { sky: '#2b1a23', far: '#55353c', middle: '#81513f', ground: '#2d252e', edge: '#c88252', accent: '#ffc98b', glow: '#fff0bb' },
  fable: { sky: '#201c38', far: '#3d365a', middle: '#69618b', ground: '#342b48', edge: '#a99abd', accent: '#dec3f1', glow: '#f5e1fb' },
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
  // The authored ledge surfaces in the 160×30 logical pixel paintings, before their 3× storage expansion.
  haiku: { leftX: 49 / 160, rightX: 111 / 160, topY: 23 / 30 },
  sonnet: { leftX: 48.5 / 160, rightX: 111.5 / 160, topY: 24 / 30 },
  opus: { leftX: 51 / 160, rightX: 109 / 160, topY: 23 / 30 },
  fable: { leftX: 49 / 160, rightX: 111 / 160, topY: 24 / 30 },
}
const n = (v: number) => Math.round(v * 1000) / 1000

/** Included once in the scene's defs. Opacity feathers reveal the host background without choosing its colour. */
export function arenaEdgeDefinitions(w: number, h: number): string {
  const side = Math.min(40, w * 0.065), left = n(side / w), right = n(1 - side / w)
  const top = n(Math.min(8, h / 3) / h), bottom = n(1 - Math.min(12, h / 3) / h)
  return `<linearGradient id="arena-edge-horizontal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="${left}" stop-color="white" stop-opacity="1"/><stop offset="${right}" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><linearGradient id="arena-edge-vertical" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="${top}" stop-color="white" stop-opacity="1"/><stop offset="${bottom}" stop-color="white" stop-opacity="1"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><mask id="arena-edge-vertical-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="url(#arena-edge-vertical)"/></mask><mask id="arena-edge-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="url(#arena-edge-horizontal)" mask="url(#arena-edge-vertical-mask)"/></mask>`
}

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
  const base = `<use href="#arena-paint" x="${o.baseX}" y="${o.yOffset}"/>`
  const views = o.maskedViews ? `<g mask="url(#arena-camera-left-mask)"><use href="#arena-paint" x="${o.leftX}" y="${o.yOffset}"/></g><g mask="url(#arena-camera-right-mask)"><use href="#arena-paint" x="${o.rightX}" y="${o.yOffset}"/></g>` : ''
  // Depth belongs to the authored palette, scale and overlap. Preserve every pixel of the painting, and keep
  // the raw camera layer distinct from the scene's contact shadows, actors and near-edge silhouettes.
  const defs = `<defs><image id="arena-paint" width="${o.bgWidth}" height="${n(o.bgHeight)}" href="${pngDataUri}" style="image-rendering:pixelated"/>${gradients}<g id="arena-camera-scene">${base}${views}</g></defs>`
  return defs + `<rect width="${width}" height="${height}" fill="${THEMES[family].sky}"/><g id="arena-depth-far"><use href="#arena-camera-scene"/></g>`
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
  return `<g clip-path="url(#arena-clip)" mask="url(#arena-edge-mask)">${cameraFragment(arena, ARENA_PNG[arena], w, height)}<g shape-rendering="crispEdges">${p.finish()}</g></g>`
}

/** Sparse near-edge silhouettes, placed after the fighters and before callouts by the scene owner. */
export function arenaForeground(arena: Family, w: number, h: number): string {
  const p = painter(), cell = 6, y = snap(h - 48)
  // Five/six-cell silhouettes follow the same chunky grid as the authored world. Both envelopes stay within
  // 36 px of the edge, outside even the narrow actors/HUD; their roots continue offstage through the edge fade.
  const tiles: Record<Family, readonly string[]> = {
    haiku: ['..o...', '.omo..', 'ommmo.', '..o...', '.omo..', '..o...', '..o...', '..o...', '..o...'],
    sonnet: ['o.....', 'o...m.', 'o..mo.', 'o.mo..', 'omo...', 'oo....', 'ooo...', 'oooo..', 'ooooo.'],
    opus: ['o.....', 'o.....', 'om....', 'omo.o.', 'ooooo.', 'ooooo.', 'oooooo', 'oooooo', 'oooooo'],
    fable: ['..o...', '.omo..', '.omo..', '.omo..', '.ooo..', 'ooooo.', 'ooooo.', 'oooooo', 'oooooo'],
  }
  const middle: Record<Family, string> = { haiku: '#385439', sonnet: '#405967', opus: '#704a37', fable: '#6a547c' }
  for (const mirror of [false, true]) tiles[arena].forEach((row, yy) => {
    for (let x = 0; x < row.length; x++) {
      const color = row[x] === 'o' ? '#1d1726' : row[x] === 'm' ? middle[arena] : null
      if (color) p.rect(mirror ? w - (x + 1) * cell : x * cell, y + yy * cell, cell, cell, color)
    }
  })
  return `<g id="arena-foreground" clip-path="url(#arena-clip)" mask="url(#arena-edge-mask)"><g shape-rendering="crispEdges">${p.finish()}</g></g>`
}

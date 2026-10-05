// The design tokens (SPEC 21): one source for colours, marks, spacing, sizes and labels, so the same card looks the
// same everywhere. Colours are #rrggbb, the one form every surface paints. Marks are single width-1 BMP glyphs of
// neutral East Asian width (they never double up in a CJK terminal) and never emoji.
import type { Family, Rarity } from '../core/types.ts'

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa3ad',
  rare: '#4f8ff0',
  epic: '#b06ef3',
  legendary: '#f2b33d',
}
/** Mythics read as their own tier in colour, always with a foil border; they count as legendary everywhere else. */
export const MYTHIC_COLOR = '#ff7ac6'

export const FAMILY_COLOR: Record<Family, string> = {
  haiku: '#5fbf8f',
  sonnet: '#5b8def',
  opus: '#e8744f',
  fable: '#a874e8',
}

/** One mark per family, used wherever a family shows: a florette, a wave, a sunburst, a moon. */
export const FAMILY_MARK: Record<Family, string> = {
  haiku: '✿',
  sonnet: '∿',
  opus: '✹',
  fable: '☾',
}

/**
 * Marks for stamps and celebrations; a stamp's mark always carries its word (never colour or a glyph alone, SPEC
 * 21.9), and finishes show as words (`Alt colour`, `Foil`), never as a glyph.
 */
export const MARK = {
  first: '✪',
  mythic: '❖',
  /** the welcome and other celebrations (SPEC 34.3) */
  sparkle: '✦',
  bullet: '·',
  /** sparks, the game's coin: a price chip, a balance */
  spark: '✧',
  /** a swap: the card a listing wants in return */
  swap: '⇄',
  /** a duel won; a player beaten (crossed swords, as on the site) */
  win: '✓',
  beaten: '⚔',
  /** a catch, a species, a sale */
  caught: '✺',
  species: '❀',
  rank: '✶',
  /** the collection is not backed up yet (no passkey) */
  unsaved: '◌',
  /** a small square: the world in play, a league's colour */
  dot: '▪',
  away: '▫',
} as const

/**
 * The icons of the boards and the stat tiles, each with its colour: one glyph per number, the same on a profile, a
 * tile and a board, so a number reads at a glance without its word.
 */
export const STAT = {
  rating: { mark: MARK.rank, color: '#f2b33d' },
  duelWins: { mark: MARK.win, color: '#7cc47f' },
  beaten: { mark: MARK.beaten, color: '#c9cfe0' },
  catches: { mark: MARK.caught, color: '#5fbf8f' },
  species: { mark: MARK.species, color: '#a874e8' },
  firsts: { mark: MARK.first, color: '#f2b33d' },
  mythics: { mark: MARK.mythic, color: '#ff7ac6' },
  sales: { mark: MARK.spark, color: '#5b8def' },
} as const

/** League colours, Pebble to Star, for the badge on a board row and a profile. */
export const LEAGUE_COLOR: Record<'Pebble' | 'Brook' | 'Grove' | 'Peak' | 'Star', string> = {
  Pebble: '#9aa3ad', Brook: '#4f8ff0', Grove: '#5fbf8f', Peak: '#b06ef3', Star: '#f2b33d',
}

/** Ink for states, muted so rarity and family colours stay the loudest thing on a card. */
export const INK = {
  accent: '#f2b33d',
  good: '#7cc47f',
  warn: '#e2b552',
  bad: '#d9675a',
  muted: '#8a8f98',
  /** the reveal's flash and highlight */
  bright: '#fffdf5',
} as const

export function hpColor(fraction: number): string {
  return fraction > 0.5 ? INK.good : fraction > 0.2 ? INK.warn : INK.bad
}

/**
 * Spacing. Box gaps, margins and padding take the cell scale on every surface: 0, 1 or 2 (SPEC 21), the larger for
 * the larger element. The desktop's 4 / 8 / 16 / 32 px scale sizes its Svg art and the gaps inside it.
 */
export const SPACE = { none: 0, tight: 1, loose: 2 } as const

/** Sprite sizes in pixels, and how many cells they take on the terminal (half blocks: two pixel rows per cell). */
export const SPRITE = {
  card: { px: 16, columns: 16, rows: 8 },
  mini: { px: 8, columns: 8, rows: 4 },
} as const

/** The terminal card art: the sprite inside a one-cell frame. */
export const ART = { columns: SPRITE.card.columns + 2, rows: SPRITE.card.rows + 2 } as const

/** Desktop pixel scale per size: a 16 px sprite at 8x is 128 px; tiles at 4x; minis at 4x. */
export const SVG_SCALE = { full: 8, tile: 4, mini: 4 } as const

export const RARITY_WORD: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }
export const RARITY_INITIAL: Record<Rarity, string> = { common: 'C', rare: 'R', epic: 'E', legendary: 'L' }

/** The rainbow a foil border runs through, as hues; frame cell i takes hue (i * FOIL_STEP + t * 90) mod 360. */
export const FOIL_STEP = 18

/** A colour from a hue (degrees), saturation and lightness 0..1, as 0xRRGGBB. */
export function hslInt(h: number, s = 0.75, l = 0.62): number {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.min(1, Math.max(0, s)), lit = Math.min(1, Math.max(0, l))
  const k = (n: number) => (n + hue / 30) % 12
  const a = sat * Math.min(lit, 1 - lit)
  const f = (n: number) => Math.round(255 * (lit - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return (f(0) << 16) | (f(8) << 8) | f(4)
}

export function hexInt(color: string): number {
  return Number.parseInt(color.slice(1), 16) & 0xffffff
}

export function hex6(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

/** The foil rainbow as Svg gradient stops. */
export const RAINBOW_STOPS = [0, 60, 120, 180, 240, 300, 360]
  .map((h, i) => `<stop offset="${(i / 6).toFixed(3)}" stop-color="${hex6(hslInt(h, 0.8, 0.62))}"/>`).join('')

/**
 * Pixels as Svg rects, one per horizontal run of a colour: `k` px a pixel, offset (dx, dy) pixels, every rect in
 * `fill` when given (a silhouette, a mask). The one way the mod's Svgs draw pixel art.
 */
export function pixelRects(px: readonly (readonly number[])[], k = 1, dx = 0, dy = 0, fill?: string): string {
  let out = ''
  for (let y = 0; y < px.length; y++) {
    const row = px[y]!
    for (let x = 0; x < row.length;) {
      const c = row[x]!
      let run = 1
      while (x + run < row.length && row[x + run] === c) run++
      if (c >= 0) out += `<rect x="${(x + dx) * k}" y="${(y + dy) * k}" width="${run * k}" height="${k}" fill="${fill ?? hex6(c)}"/>`
      x += run
    }
  }
  return out
}

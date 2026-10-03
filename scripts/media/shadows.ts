// The season held back: a species nobody has found yet, drawn the way the game draws one it has not shown you. The
// body is the band's rustle (battleview.ts: the silhouette in the shadow colour with a lighter rim, and the gold rim a
// legendary rustles with), caught between wobbles. The eyes it opens when it stirs are its real eye pixels, found the
// way the site's sprite layers find them (pages-sprite.ts). Names, colours and later stages never leave the core.
import type { Species } from '../../plugin/hooks/core/types.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { foreshadowOf, rustleFrame } from '../../plugin/hooks/client/battleview.ts'
import { spriteLayers } from '../../server/src/pages-sprite.ts'

const T = -1

/** The form the album keeps for a species: a regular's first stage, a legendary's one form (card.tsx's formArt). */
export const albumForm = (s: Species): Pixels => spriteFor({ form: s, stage: s.legendary ? 3 : 1 })

/** Moments of the rustle with no wobble (t % 900 >= 520): the gold rim at the bottom and the top of its pulse. */
const STILL = { dim: 754, bright: 3266 }

/** The rustle's shadow, still; a legendary's rim gold, dim or at its brightest. */
export function shadow(px: Pixels, legendary: boolean, bright = false): Pixels {
  const fore = foreshadowOf({ species: 'shadow', rarity: legendary ? 'legendary' : 'common', shiny: false })
  const out = rustleFrame(px, fore, bright ? STILL.bright : STILL.dim, '')
  // STILL hangs on battleview.ts's burst window: if a wobble ever lands there, the shadow no longer fits its sprite
  if (out.some((r, y) => r.some((c, x) => (c === T) !== (px[y]![x] === T)))) throw new Error('shadows: the rustle moved at STILL')
  return out
}

/** The cells of a sprite's eyes, in `colour` (the eye colour, its catchlights and a sparkle eye's iris). */
export function eyes(px: Pixels, colour: number): Pixels {
  const on = new Set<string>()
  for (const m of spriteLayers(px).eyes.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    for (let i = 0; i < Number(m[3]); i++) on.add(`${Number(m[1]) + i},${m[2]}`)
  }
  return px.map((row, y) => row.map((_, x) => (on.has(`${x},${y}`) ? colour : T)))
}

/** Which ways the eyes can glance and stay inside the body: any of l r u d (the site's data-eo). */
export const glances = (px: Pixels): string => spriteLayers(px).eo

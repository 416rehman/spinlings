// Poster (d): the season's 36 species, four families of eight plus their legendary, framed the way the album frames
// them (card.tsx's own art: the rarity frame, the foil gradient and sheen on legendaries). The regular species grow
// through their three stages in one slow wave across the poster, names changing with them; legendaries are already
// in their final form. One loop: stage 1, 2, 3, back to 1.
import type { Family, Species } from '../../plugin/hooks/core/types.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import { FAMILY_COLOR, FAMILY_MARK, RARITY_COLOR, hexInt } from '../../plugin/hooks/ui/tokens.ts'
import { pixelTextSvg } from '../../server/src/pages-art.ts'
import { compact } from './clock.ts'
import { doc } from './desk.ts'
import type { Theme } from './view.ts'
import { MONO, embed } from './view.ts'

const { artSvg } = await import('../../plugin/hooks/ui/card.tsx')

const SEASON = 1
const SCALE = 4
const TILE = 18 * SCALE
const GAP = 16
const COL = TILE + GAP
const MARGIN = 36
const ROW = TILE + 80
const HEAD = 132
export const POSTER = { w: MARGIN * 2 + 9 * COL - GAP, h: HEAD + 4 * ROW + 40 }

/** Each stage shows this long; the wave crosses the poster column by column. */
const STAGE_MS = 3200
const WAVE_MS = 70
const LOOP = STAGE_MS * 3
const FLASH = 140
const EMPTY = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => -1))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kt = (ms: number) => +(((ms % LOOP) + LOOP) % LOOP / LOOP).toFixed(5)

/** Visible during [from, to) of the loop, forever (no syncbase: one discrete animation per element). */
function shown(from: number, to: number): string {
  const a = kt(from), b = kt(to)
  if (a < b) return `<animate attributeName="visibility" values="hidden;visible;hidden" keyTimes="0;${a};${b}" calcMode="discrete" dur="${LOOP / 1000}s" repeatCount="indefinite"/>`
  return `<animate attributeName="visibility" values="visible;hidden;visible" keyTimes="0;${b};${a}" calcMode="discrete" dur="${LOOP / 1000}s" repeatCount="indefinite"/>`
}

function tile(s: Species, x: number, y: number, col: number, t: Theme): string {
  const name = (text: string, color: string) => `<text x="${x + TILE / 2}" y="${y + TILE + 22}" text-anchor="middle" font-size="12" font-weight="${s.legendary ? 700 : 500}" fill="${color}">${esc(text)}</text>`
  if (s.legendary) {
    const art = artSvg(spriteFor({ form: s, stage: 3 }), { color: hexInt(RARITY_COLOR.legendary), rainbow: true, sparkle: false }, SCALE, true)
    return embed(art, x, y, TILE, TILE) + name(s.names[2], RARITY_COLOR.legendary)
      + `<text x="${x + TILE / 2}" y="${y + TILE + 38}" text-anchor="middle" font-size="11" fill="${t.dim}">Legendary</text>`
  }
  // the album's common frame, drawn once: the same rect artSvg draws around a framed card
  let out = embed(artSvg(EMPTY, { color: hexInt(RARITY_COLOR.common), rainbow: false, sparkle: false }, SCALE, false), x, y, TILE, TILE)
  for (const stage of [1, 2, 3] as const) {
    const px = spriteFor({ form: s, stage })
    const start = (stage - 1) * STAGE_MS + col * WAVE_MS
    const id = `${s.id}-${stage}`
    out += `<g visibility="hidden">${shown(start, start + STAGE_MS)}<g id="${id}">${embed(artSvg(px, null, SCALE, false), x + SCALE, y + SCALE, TILE - 2 * SCALE, TILE - 2 * SCALE)}</g>${name(s.names[stage - 1]!, t.text)}</g>`
    // the evolution's flash: a white silhouette of the stage arriving
    out += `<g visibility="hidden">${shown(start, start + FLASH)}<use href="#${id}" filter="url(#white)"/></g>`
  }
  for (const stage of [1, 2, 3] as const) {
    const start = (stage - 1) * STAGE_MS + col * WAVE_MS
    out += `<text x="${x + TILE / 2}" y="${y + TILE + 38}" text-anchor="middle" font-size="11" fill="${t.dim}" visibility="hidden">${shown(start, start + STAGE_MS)}Stage ${stage}</text>`
  }
  return out
}

function familyRow(f: Family, y: number, t: Theme): string {
  const list = familySpecies(SEASON, f)
  const label = `<text x="${MARGIN}" y="${y - 16}" font-size="13" font-weight="700"><tspan fill="${FAMILY_COLOR[f]}">${FAMILY_MARK[f]} ${FAMILY_INFO[f].name}</tspan>`
    + `<tspan fill="${t.dim}" font-weight="400">  ${esc(FAMILY_INFO[f].special[0]!.toUpperCase() + FAMILY_INFO[f].special.slice(1))} · beats ${FAMILY_INFO[FAMILY_INFO[f].beats].name}</tspan></text>`
  return label + list.map((s, i) => tile(s, MARGIN + i * COL, y, i, t)).join('')
}

export function gallerySvg(t: Theme): string {
  const { w, h } = POSTER
  const mark = pixelTextSvg('spinlings', { scale: 4 }).replace(/currentColor/g, t.text)
  let body = `<defs><filter id="white" x="0" y="0" width="1" height="1"><feFlood flood-color="#ffffff"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>`
  body += `<rect width="${w}" height="${h}" rx="14" fill="${t.bg}"/>`
  body += embed(mark.replace(/^<svg[^>]*?(viewBox="[^"]+")[^>]*>/, '<svg $1 shape-rendering="crispEdges">'), MARGIN, 34, Number(/width="(\d+)"/.exec(mark)![1]), Number(/height="(\d+)"/.exec(mark)![1]))
  body += `<text x="${MARGIN}" y="${100}" font-size="14" fill="${t.dim}">Season ${SEASON} · 36 species · four families, eight each and a legendary</text>`
  body += `<text x="${w - MARGIN}" y="${70}" text-anchor="end" font-size="12" fill="${t.dim}">every card hatches with its own colours, genes and traits</text>`
  FAMILIES.forEach((f, i) => { body += familyRow(f, HEAD + 22 + i * ROW, t) })
  return doc(w, h, t, `<g font-family="${MONO}">${compact(body)}</g>`, `Spinlings season ${SEASON}: all 36 species, growing through their three stages`)
}

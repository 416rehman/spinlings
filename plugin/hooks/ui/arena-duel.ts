// A shared desktop battlefield. Scenery is cosmetic; health and every animation beat use the round on screen.
import type { DailyRule, Family } from '../core/types.ts'
import type { Fighter, RoundPlan, Side } from '../client/battleview.ts'
import { TIMING } from '../client/anim.ts'
import { effortLook } from '../client/effort.ts'
import { fit, safe } from '../client/text.ts'
import { calloutTimeline, fighterSvg } from './band-art.tsx'
import { arenaBackdrop, arenaTheme } from './arena-art.ts'
import { FAMILY_COLOR, FAMILY_MARK, hex6, hpColor } from './tokens.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`
const FONT = 'font-family="Segoe UI,system-ui,sans-serif"'
const text = (x: number, y: number, value: string, color: string, size = 11, anchor = 'start', bold = false) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${bold ? ' font-weight="700"' : ''} ${FONT}>${esc(value)}</text>`

export const arenaSize = (columns: number) => ({ w: Math.min(1280, columns * 8), height: 144 })

function health(f: Fighter, plan: RoundPlan | null, side: Side, x: number, y: number, width: number, start: number, motion: boolean): string {
  const mirror = side === 'd'
  const fraction = (hp: number) => Math.max(0, Math.min(1, f.maxHp > 0 ? hp / f.maxHp : 0))
  const initial = plan ? plan.start[side] : f.hp
  const changes: { at: number; hp: number }[] = []
  if (motion && plan) {
    for (const hit of plan.hits) if (hit.after[side] !== hit.before[side]) changes.push({ at: hit.at, hp: hit.after[side] })
    const last = plan.hits.at(-1)?.after[side] ?? initial
    if (plan.end[side] !== last) changes.push({ at: plan.endAt, hp: plan.end[side] })
  }
  let animation = '', previous = initial
  for (const change of changes) {
    const from = Math.round(width * fraction(previous)), to = Math.round(width * fraction(change.hp))
    const beat = `begin="${seconds(change.at - start)}" dur="${seconds(TIMING.drain)}" calcMode="spline" keyTimes="0;1" keySplines="0.215 0.61 0.355 1" fill="freeze"`
    animation += `<animate attributeName="width" from="${from}" to="${to}" ${beat}/>`
    if (mirror) animation += `<animate attributeName="x" from="${x + width - from}" to="${x + width - to}" ${beat}/>`
    animation += `<set attributeName="fill" to="${hpColor(fraction(change.hp))}" begin="${seconds(change.at + TIMING.drain - start)}"/>`
    previous = change.hp
  }
  const initialWidth = Math.round(width * fraction(initial))
  let digits = ''
  const marks = [{ at: 0, hp: initial }, ...changes.map(change => ({ at: change.at + TIMING.drain / 2, hp: change.hp }))]
  marks.forEach((mark, i) => {
    const label = `<g stroke="#102019" stroke-width="2" paint-order="stroke">${text(x + width / 2, y + 8, `HP ${Math.max(0, Math.ceil(mark.hp))}/${f.maxHp}`, '#f6faf5', 10, 'middle', true)}</g>`
    if (marks.length === 1) digits += label
    else {
      const next = marks[i + 1]
      const visible = mark.at <= start && (!next || next.at > start)
      digits += `<g visibility="${visible ? 'visible' : 'hidden'}">${mark.at > start ? `<set attributeName="visibility" to="visible" begin="${seconds(mark.at - start)}"/>` : ''}${next && next.at > start ? `<set attributeName="visibility" to="hidden" begin="${seconds(next.at - start)}"/>` : ''}${label}</g>`
    }
  })
  return `<rect x="${x}" y="${y}" width="${width}" height="11" rx="4" fill="#1c2930" stroke="#799b92" stroke-opacity="0.4"/>`
    + `<rect x="${mirror ? x + width - initialWidth : x}" y="${y}" width="${initialWidth}" height="11" rx="4" fill="${hpColor(fraction(initial))}">${animation}</rect>` + digits
}

export function arenaSvg(o: {
  columns: number; arena: Family; rule: DailyRule; opponent: string;
  fighters: { a: Fighter | null; d: Fighter | null }; plan: RoundPlan | null;
  start: number; motion: boolean; effort?: unknown; instance?: string;
}): string {
  const { w, height } = arenaSize(o.columns)
  const wide = o.columns >= 80, k = wide ? 6 : 5, sprite = 16 * k
  const theme = arenaTheme(o.arena), look = effortLook(o.effort)
  const floor = Math.round(height * 0.88 / 2) * 2
  const hudWidth = wide ? 160 : Math.min(108, Math.floor(w * 0.3))
  const nameY = 16, barY = 22
  const ownX = Math.round(w * 0.3 / 2) * 2, foeX = Math.round(w * 0.7 / 2) * 2
  let body = arenaBackdrop(o.arena, o.rule, w, height)
  const rivalSpace = w - 2 * (ownX + hudWidth / 2 + 6)
  if (wide) body += text(w / 2, 17, fit(theme.name, Math.max(8, Math.floor(rivalSpace / 6))), theme.accent, 12, 'middle', true)
  for (const side of ['a', 'd'] as const) {
    const f = o.fighters[side]
    if (!f) continue
    const center = side === 'a' ? ownX : foeX
    const x = Math.max(12, Math.min(w - 12 - hudWidth, Math.round(center - hudWidth / 2)))
    const anchor = side === 'a' ? 'start' : 'end', tx = side === 'a' ? x : x + hudWidth
    body += `<rect x="${x - 6}" y="3" width="${hudWidth + 12}" height="34" rx="5" fill="#102025" opacity="0.65"/>`
    body += text(tx, nameY, fit(`${FAMILY_MARK[f.card.family]} ${safe(f.name, 40)}`, Math.floor(hudWidth / (wide ? 7.5 : 6.5))), '#f3f5ee', wide ? 13 : 11, anchor, true)
    body += health(f, o.plan, side, x, barY, hudWidth, o.start, o.motion)
  }
  body += `<ellipse id="effort-a" cx="${ownX}" cy="${floor + 2}" rx="${sprite * 0.55}" ry="5" fill="none" stroke="${FAMILY_COLOR[o.arena]}" stroke-opacity="${look.opacity}" stroke-width="${look.width}"/>`
  body += `<ellipse cx="${foeX}" cy="${floor + 2}" rx="${sprite * 0.55}" ry="5" fill="none" stroke="${theme.accent}" stroke-opacity="0.45"/>`
  body += `<g clip-path="url(#arena-clip)">${fighterSvg(o.fighters.a, o.plan, 'a', { x: ownX - sprite / 2, y: floor - sprite, k, start: o.start, motion: o.motion })}${fighterSvg(o.fighters.d, o.plan, 'd', { x: foeX - sprite / 2, y: floor - sprite, k, start: o.start, motion: o.motion })}</g>`
  if (o.motion && o.plan) for (const side of ['a', 'd'] as const) {
    const list = calloutTimeline(o.plan, side)
    const font = wide ? 10 : 9, limit = Math.floor(w * 0.43 / (font * 0.62))
    list.forEach((callout, i) => {
      const next = list[i + 1]
      const visible = callout.at <= o.start && (!next || next.at > o.start)
      const label = text(side === 'a' ? ownX : foeX, height - 3, fit(callout.text, limit), hex6(callout.color), font, 'middle', true)
      body += `<g visibility="${visible ? 'visible' : 'hidden'}" stroke="#10171f" stroke-width="3" paint-order="stroke">${callout.at > o.start ? `<set attributeName="visibility" to="visible" begin="${seconds(callout.at - o.start)}"/>` : ''}${next && next.at > o.start ? `<set attributeName="visibility" to="hidden" begin="${seconds(next.at - o.start)}"/>` : ''}${label}</g>`
    })
  }
  // Image-mode SVGs share cached documents by URI. Distinguish rounds without restarting on unrelated UI updates.
  const instance = o.instance ? `<metadata id="arena-instance">${esc(safe(o.instance, 120))}</metadata>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w}" height="${height}">${instance}<defs><clipPath id="arena-clip"><rect width="${w}" height="${height}" rx="6"/></clipPath></defs>${body}</svg>`
}

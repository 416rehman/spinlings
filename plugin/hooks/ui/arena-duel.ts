// A shared desktop battlefield. Scenery is cosmetic; health and every animation beat use the round on screen.
import type { DailyRule, Family } from '../core/types.ts'
import type { Fighter, RoundPlan, Side } from '../client/battleview.ts'
import { TIMING } from '../client/anim.ts'
import { effortLook } from '../client/effort.ts'
import { fit, safe } from '../client/text.ts'
import { calloutTimeline, fighterSvg } from './band-art.tsx'
import { arenaBackdrop, arenaTheme } from './arena-art.ts'
import { FAMILY_COLOR, FAMILY_MARK, MYTHIC_COLOR, RARITY_COLOR, hex6, hpColor } from './tokens.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`
const FONT = 'font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"'
const text = (x: number, y: number, value: string, color: string, size = 11, anchor = 'start', bold = false) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${bold ? ' font-weight="700"' : ''} ${FONT}>${esc(value)}</text>`

export const arenaSize = (columns: number) => ({ w: Math.min(1280, columns * 8), height: columns >= 80 ? 144 : 124 })

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
    const label = text(mirror ? x + width : x, y + 19, `HP ${Math.max(0, Math.ceil(mark.hp))}/${f.maxHp}`, '#d6dce4', 10, mirror ? 'end' : 'start')
    if (marks.length === 1) digits += label
    else {
      const next = marks[i + 1]
      const visible = mark.at <= start && (!next || next.at > start)
      digits += `<g visibility="${visible ? 'visible' : 'hidden'}">${mark.at > start ? `<set attributeName="visibility" to="visible" begin="${seconds(mark.at - start)}"/>` : ''}${next && next.at > start ? `<set attributeName="visibility" to="hidden" begin="${seconds(next.at - start)}"/>` : ''}${label}</g>`
    }
  })
  return `<rect x="${x}" y="${y}" width="${width}" height="6" rx="3" fill="#33404a"/>`
    + `<rect x="${mirror ? x + width - initialWidth : x}" y="${y}" width="${initialWidth}" height="6" rx="3" fill="${hpColor(fraction(initial))}">${animation}</rect>` + digits
}

export function arenaSvg(o: {
  columns: number; arena: Family; rule: DailyRule; opponent: string;
  fighters: { a: Fighter | null; d: Fighter | null }; plan: RoundPlan | null;
  start: number; motion: boolean; effort?: unknown;
}): string {
  const { w, height } = arenaSize(o.columns)
  const wide = o.columns >= 80, k = wide ? 4 : 3, sprite = 16 * k
  const theme = arenaTheme(o.arena), look = effortLook(o.effort)
  const floor = Math.round(height * 0.88 / 2) * 2
  const hudWidth = wide ? 160 : Math.min(132, Math.floor(w * 0.36))
  const nameY = wide ? 17 : 34, barY = wide ? 24 : 41
  const ownX = Math.round(w * 0.23 / 2) * 2, foeX = Math.round(w * 0.77 / 2) * 2
  let body = arenaBackdrop(o.arena, o.rule, w, height)
  body += `<rect width="${w}" height="${wide ? 58 : 62}" fill="#10171f" opacity="0.7"/>`
  const rivalSpace = wide ? w - 2 * (ownX + hudWidth / 2 + 12) : w - 24
  body += text(w / 2, 16, fit(safe(`vs ${o.opponent}`, 48), Math.max(12, Math.floor(rivalSpace / 7))), '#f2f0f6', 12, 'middle', true)
  if (wide) body += text(w / 2, 33, theme.name, theme.accent, 10, 'middle')
  for (const side of ['a', 'd'] as const) {
    const f = o.fighters[side]
    if (!f) continue
    const center = side === 'a' ? ownX : foeX
    const x = Math.max(12, Math.min(w - 12 - hudWidth, Math.round(center - hudWidth / 2)))
    const anchor = side === 'a' ? 'start' : 'end', tx = side === 'a' ? x : x + hudWidth
    const rarity = f.card.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[f.card.rarity]
    body += text(tx, nameY, fit(`${FAMILY_MARK[f.card.family]} ${safe(f.name, 40)}`, Math.floor(hudWidth / 7)), rarity, 11, anchor, true)
    body += health(f, o.plan, side, x, barY, hudWidth, o.start, o.motion)
    if (wide) body += text(tx, 54, fit(`${f.special} ${'●'.repeat(Math.min(f.need, f.charge))}${'○'.repeat(Math.max(0, f.need - f.charge))}`, 25), f.charge >= f.need ? '#f2c76b' : '#adb6c6', 10, anchor)
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w}" height="${height}"><defs><clipPath id="arena-clip"><rect width="${w}" height="${height}" rx="6"/></clipPath></defs>${body}</svg>`
}

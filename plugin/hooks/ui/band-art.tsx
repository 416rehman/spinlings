// The band's desktop art (SPEC 14, 35): one Svg per moment, animated with SMIL inside the markup (never script), so
// each state plays without a redraw. Every timeline comes from client/battleview.ts, the same beats the terminal's
// frames follow, and every sprite from the same pixels. Creatures sit on a small dark plate so they read in both the
// light and the dark desktop theme. `start` resumes a timeline already that far along (a redraw mid-moment).
import type { BattleCard, Family } from '../core/types.ts'
import type { Pixels } from '../core/sprite.ts'
import { FAMILY_COLOR, FAMILY_MARK, INK, MYTHIC_COLOR, RARITY_COLOR, hex6, hexInt, hpColor, pixelRects as rects } from './tokens.ts'
import { T, TIMING, cardBack, dissolve, flash, glowOutline, place, silhouette, sparkles, squash } from '../client/anim.ts'
import type { Fighter, Foreshadow, RoundPlan, Side } from '../client/battleview.ts'
import { SHADOW, catchBeats, catchPreMs, evolveSwitches, lookAt, spriteOf } from '../client/battleview.ts'
import { fit } from '../client/text.ts'
import { eggPixels, eggSpeck, packagePixels, presentPixels } from './ceremony-art.tsx'

const s3 =(ms: number) => `${(ms / 1000).toFixed(3)}s`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PLATE = '#1b1824'
const INKS = { text: '#ece9f5', dim: '#a9a4bb', bad: INK.bad, good: INK.good, gold: INK.accent }
const FONT = 'font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"'

function doc(w: number, h: number, body: string, defs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}

/** Shown only during [from, to) of the timeline (ms; to null: from then on), resuming `start` ms in. */
function during(from: number, to: number | null, start: number): string {
  const on = `<set attributeName="visibility" to="visible" begin="${s3(from - start)}"/>`
  return to === null ? on : on + `<set attributeName="visibility" to="hidden" begin="${s3(to - start)}"/>`
}

/** Shown during [from, to) of every `period` ms, forever. */
function loopShown(from: number, to: number, period: number): string {
  const kt = (ms: number) => (ms / period).toFixed(4)
  const values = from <= 0 ? 'visible;hidden' : 'hidden;visible;hidden'
  const times = from <= 0 ? `0;${kt(to)}` : `0;${kt(from)};${kt(to)}`
  return `<animate attributeName="visibility" calcMode="discrete" values="${values}" keyTimes="${times}" dur="${s3(period)}" repeatCount="indefinite"/>`
}

const group = (inner: string, attrs = '') => `<g${attrs ? ' ' + attrs : ''}>${inner}</g>`
const hidden = (inner: string, anim: string) => `<g visibility="hidden">${anim}${inner}</g>`
const shift = (values: string, begin: number, dur: number, o: { repeat?: boolean; freeze?: boolean } = {}) =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" begin="${s3(begin)}" dur="${s3(dur)}" additive="sum"${o.repeat ? ' repeatCount="indefinite"' : ''}${o.freeze ? ' fill="freeze"' : ''}/>`

function plate(w: number, h: number, stroke: string, o: { gold?: boolean } = {}): string {
  const pulse = o.gold ? `<animate attributeName="stroke-opacity" values="0.4;1;0.4" dur="1.2s" repeatCount="indefinite"/>` : ''
  return `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="${PLATE}" fill-opacity="0.94" stroke="${stroke}" stroke-opacity="${o.gold ? 1 : 0.55}" stroke-width="${o.gold ? 2 : 1}">${pulse}</rect>`
}

/** A sprite placed at (x, y) px at `k` px a pixel, crisp. */
const sprite = (px: Pixels, k: number, x: number, y: number, inner = '') =>
  `<g transform="translate(${x} ${y})">${inner}<g shape-rendering="crispEdges">${rects(px, k)}</g></g>`

const rarityHex = (c: Pick<BattleCard, 'species' | 'rarity'>) => (c.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[c.rarity])

// ---------- the battle: one plate per creature ----------

export type HudSize = { k: number; pad: number; info: number; font: number }
export const HUD = { wide: { k: 3, pad: 6, info: 112, font: 11 }, narrow: { k: 2, pad: 6, info: 84, font: 10 } } as const

export function hudSize(s: HudSize): { w: number; h: number } {
  return { w: s.pad * 3 + 16 * s.k + s.info, h: 16 * s.k + s.pad * 2 }
}

const barWidth = (s: HudSize) => Math.round(s.info * 0.62)

/**
 * A creature's plate for the round being animated: the sprite, name and family mark, HP bar and numbers, callouts
 * and the special's charge, with the round's beats played by SMIL. `start` resumes the round that far in.
 */
export function hudSvg(f: Fighter | null, plan: RoundPlan | null, side: Side, s: HudSize, o: { start?: number; motion: boolean }): string {
  const { w, h } = hudSize(s)
  if (!f) return doc(w, h, plate(w, h, '#3a3646'))
  const start = o.start ?? 0
  const mirror = side === 'd'
  const sp = 16 * s.k
  const sx = mirror ? w - s.pad - sp : s.pad
  const ix = mirror ? s.pad : s.pad * 2 + sp
  const px = spriteOf(f.card, 'full')
  const anim = o.motion && plan !== null
  const toward = side === 'a' ? 1 : -1
  const rarity = rarityHex(f.card)
  const fam = FAMILY_COLOR[f.card.family]
  const hits = anim ? plan!.hits : []

  // the creature, with its round's motion
  let moves = ''
  if (anim && plan!.stepIn[side]) moves += shift(`${-toward * sp} 0;0 0`, -start, TIMING.stepIn, { freeze: true })
  let overlays = ''
  const gone = plan ? plan.start[side] <= 0 : f.hp <= 0
  for (const hit of hits) {
    const x = hit.action
    if (hit.actor === side) {
      moves += shift(`0 0;${toward * 4} 0;0 0`, hit.at - TIMING.windup - start, TIMING.windup + 80)
      if (x.move === 'special') {
        const ring = glowOutline(px, x.perfect ? 0xf2b33d : hexInt(fam), 1).map((row, y) => row.map((c, xx) => (px[y]![xx] === T ? c : T)))
        overlays += hidden(group(rects(ring, s.k), 'shape-rendering="crispEdges"'), during(hit.at - 2 * TIMING.windup, hit.at + 80, start))
      }
      if (x.perfect) overlays += hidden(group(rects(sparkles(px, 0.2, `${f.card.id}/p`, { count: 4, color: 0xfff0a8, reach: 1 }), s.k), 'shape-rendering="crispEdges"'), during(hit.at, hit.at + 700, start))
    } else {
      overlays += hidden(group(rects(flash(px), s.k), 'shape-rendering="crispEdges"'), during(hit.at, hit.at + TIMING.hitFlash + 20, start))
      if (x.hits > 1) overlays += hidden(group(rects(flash(px), s.k), 'shape-rendering="crispEdges"'), during(hit.at + 150, hit.at + 150 + TIMING.hitFlash + 20, start))
      moves += shift('0 0;-3 0;3 0;-3 0;3 0;0 0', hit.at - start, TIMING.shake)
      if (x.targetFainted) {
        const k = hit.at + 250
        moves += `<animate attributeName="opacity" calcMode="discrete" values="1;0;1;0;1;0;1" begin="${s3(k - start)}" dur="0.45s"/>`
        moves += shift(`0 0;0 ${sp / 3}`, k + 450 - start, 200, { freeze: true })
        moves += `<animate attributeName="opacity" values="1;0" begin="${s3(k + 450 - start)}" dur="0.2s" fill="freeze"/>`
      }
    }
  }
  const body = gone ? '' : group(sprite(px, s.k, 0, 0) + overlays, `transform="translate(${sx} ${s.pad})"`)
  const creature = gone ? '' : `<g>${moves}${body}</g>`

  // numbers over the creature
  let popups = ''
  if (anim) {
    const pops: { at: number; text: string; color: string }[] = []
    for (const hit of hits) {
      const x = hit.action
      if (hit.target === side && x.dmg > 0) pops.push({ at: hit.at, text: `-${x.dmg}${x.crit ? '!' : ''}`, color: x.crit ? INKS.gold : INKS.bad })
      if (hit.actor === side && x.heal > 0) pops.push({ at: hit.at + 120, text: `+${x.heal}`, color: INKS.good })
    }
    const settled = plan!.hits.at(-1)?.after[side] ?? plan!.start[side]
    if (plan!.end[side] > settled) pops.push({ at: plan!.endAt, text: `+${plan!.end[side] - settled}`, color: INKS.good })
    for (const p of pops) {
      const begin = s3(p.at - start)
      popups += `<text x="${sx + sp / 2}" y="${s.pad + sp * 0.55}" text-anchor="middle" font-size="${s.font + 3}" font-weight="700" fill="${p.color}" stroke="${PLATE}" stroke-width="3" paint-order="stroke" opacity="0" ${FONT}>`
        + `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.5;1" begin="${begin}" dur="${s3(TIMING.popup)}"/>`
        + `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-sp / 4}" begin="${begin}" dur="${s3(TIMING.popup)}"/>${esc(p.text)}</text>`
    }
  }

  // name, bar, numbers
  const anchor = mirror ? 'end' : 'start'
  const tx = mirror ? ix + s.info : ix
  const nameText = `<text x="${tx}" y="${s.pad + s.font}" text-anchor="${anchor}" font-size="${s.font}" font-weight="700" ${FONT}>`
    + (mirror ? `<tspan fill="${fam}">${FAMILY_MARK[f.card.family]} </tspan><tspan fill="${rarity}">${esc(fit(f.name, 14))}</tspan>`
      : `<tspan fill="${rarity}">${esc(fit(f.name, 14))}</tspan><tspan fill="${fam}"> ${FAMILY_MARK[f.card.family]}</tspan>`) + '</text>'
  const bw = barWidth(s), bh = Math.max(4, Math.round(s.font * 0.5))
  const by = s.pad + s.font + 5
  const bx = mirror ? ix + s.info - bw : ix
  const frac = (v: number) => Math.max(0, Math.min(1, f.maxHp > 0 ? v / f.maxHp : 0))
  const startHp = plan ? plan.start[side] : f.hp
  let barAnim = ''
  const steps: { at: number; hp: number }[] = []
  if (anim) {
    for (const hit of hits) if (hit.after[side] !== hit.before[side]) steps.push({ at: hit.at, hp: hit.after[side] })
    const settled = plan!.hits.at(-1)?.after[side] ?? plan!.start[side]
    if (plan!.end[side] !== settled) steps.push({ at: plan!.endAt, hp: plan!.end[side] })
    let prev = startHp
    for (const st of steps) {
      const from = Math.round(bw * frac(prev)), to = Math.round(bw * frac(st.hp))
      const attr = mirror ? 'x' : 'width'
      const fromV = mirror ? bx + bw - from : from, toV = mirror ? bx + bw - to : to
      barAnim += `<animate attributeName="${attr}" from="${fromV}" to="${toV}" begin="${s3(st.at - start)}" dur="${s3(TIMING.drain)}" calcMode="spline" keyTimes="0;1" keySplines="0.215 0.61 0.355 1" fill="freeze"/>`
      if (mirror) barAnim += `<animate attributeName="width" from="${from}" to="${to}" begin="${s3(st.at - start)}" dur="${s3(TIMING.drain)}" calcMode="spline" keyTimes="0;1" keySplines="0.215 0.61 0.355 1" fill="freeze"/>`
      barAnim += `<set attributeName="fill" to="${hpColor(frac(st.hp))}" begin="${s3(st.at + TIMING.drain - start)}"/>`
      prev = st.hp
    }
  }
  const w0 = Math.round(bw * frac(startHp))
  const bar = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="#3a3646"/>`
    + `<rect x="${mirror ? bx + bw - w0 : bx}" y="${by}" width="${w0}" height="${bh}" rx="${bh / 2}" fill="${hpColor(frac(startHp))}">${barAnim}</rect>`
  const dx = mirror ? bx - 4 : bx + bw + 4
  const digitsAt = (hp: number) => `${Math.max(0, Math.ceil(hp))}/${f.maxHp}`
  let digits = ''
  const marks = [{ at: -Infinity, hp: startHp }, ...steps]
  marks.forEach((m, i) => {
    const next = marks[i + 1]
    const text = `<text x="${dx}" y="${by + bh}" text-anchor="${mirror ? 'end' : 'start'}" font-size="${s.font - 1}" fill="${INKS.dim}" ${FONT}>${digitsAt(m.hp)}</text>`
    if (marks.length === 1) digits += text
    else digits += hidden(text, during(i === 0 ? start : m.at + TIMING.drain / 2, next ? next.at + TIMING.drain / 2 : null, start))
  })

  // callouts, each until the next
  let callouts = ''
  const cy = by + bh + s.font + 4
  if (anim) {
    const list = calloutTimeline(plan!, side)
    list.forEach((c, i) => {
      const next = list[i + 1]
      callouts += hidden(`<text x="${tx}" y="${cy}" text-anchor="${anchor}" font-size="${s.font - 1}" font-weight="700" fill="${hex6(c.color)}" ${FONT}>${esc(c.text)}</text>`, during(c.at, next ? next.at : null, start))
    })
  }
  const ready = f.charge >= f.need
  const charge = `<text x="${tx}" y="${h - s.pad}" text-anchor="${anchor}" font-size="${s.font - 2}" fill="${ready ? INKS.gold : INKS.dim}" ${FONT}>${esc(f.special)} ${'●'.repeat(Math.min(f.need, f.charge))}${'○'.repeat(Math.max(0, f.need - f.charge))}</text>`
  return doc(w, h, plate(w, h, rarity) + creature + popups + nameText + bar + digits + callouts + charge)
}

/** The callouts one side shows through a round, in order (as lookAt picks them on the terminal). */
function calloutTimeline(plan: RoundPlan, side: Side): { at: number; text: string; color: number }[] {
  const out: { at: number; text: string; color: number }[] = []
  for (let t = 0; t < plan.ms; t += 20) {
    const c = lookAt(plan, side, t).callout
    const last = out.at(-1)
    if (c && (!last || last.text !== c.text)) out.push({ at: t, text: c.text, color: c.color })
  }
  return out
}

// ---------- one creature on a plate: rustle, reveal, catches, evolutions, farewells ----------

export const ART_K = 3
const ART_PAD = 6
export const artSide = (k = ART_K) => 16 * k + ART_PAD * 2

function framed(inner: string, k: number, stroke: string, o: { gold?: boolean } = {}): string {
  const side = artSide(k)
  return doc(side, side, plate(side, side, stroke, o) + `<g transform="translate(${ART_PAD} ${ART_PAD})">${inner}</g>`)
}

const crisp = (inner: string) => group(inner, 'shape-rendering="crispEdges"')

/** The rustle: the silhouette wobbles in bursts, and the rarity's foreshadowing plays on it. */
export function rustleSvg(lead: BattleCard | null, fore: Foreshadow, k = ART_K): string {
  if (!lead) return framed('', k, '#3a3646')
  const px = spriteOf(lead, 'full')
  const s = silhouette(px, SHADOW)
  const edges = s.map((row, y) => row.map((c, x) => (c !== T && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (s[y + dy!]?.[x + dx!] ?? T) === T) ? c : T)))
  let fx = rects(edges, k, 0, 0, '#625c7e')
  if (fore.shimmer || fore.gold) {
    fx += `<g opacity="0.5">${rects(edges, k, 0, 0, fore.gold ? '#f2b33d' : '#b06ef3')}<animate attributeName="opacity" values="0.25;0.95;0.25" dur="1s" repeatCount="indefinite"/></g>`
  }
  if (fore.twinkle) {
    const spot = edges.flatMap((row, y) => row.map((c, x) => (c === T ? null : [x, y] as const))).filter(v => v !== null)[3]
    if (spot) fx += hidden(`<rect x="${spot[0] * k}" y="${spot[1] * k}" width="${k}" height="${k}" fill="#ffffff"/>`, loopShown(0, 260, 800))
  }
  if (fore.mythic) {
    for (let i = 0; i < 3; i++) {
      const pick = dissolve(edges, 0.85, `rustle/${i}`)
      fx += hidden(rects(pick, k, 0, 0, i === 1 ? '#ff7ac6' : '#e8e6f0'), loopShown(i * 140, i * 140 + 90, 420))
    }
  }
  if (fore.glint) {
    const side = 16 * k
    fx += `<mask id="m"><g fill="#fff">${rects(s, k)}</g></mask>`
      + `<g mask="url(#m)"><rect x="${-side}" y="0" width="${side / 3}" height="${side}" fill="#fff4c2" opacity="0.8" transform="skewX(-20)">`
      + `<animateTransform attributeName="transform" type="translate" values="0 0;${side * 2} 0" dur="1.4s" repeatCount="indefinite" additive="sum"/></rect></g>`
  }
  const wobble = `<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="0 0;-${k} 0;0 0;${k} 0;0 0;-${k} 0;0 0;0 0;0 0;0 0" dur="0.9s" repeatCount="indefinite"/>`
  return framed(`<g>${wobble}${crisp(rects(s, k))}${fx}</g>`, k, fore.gold ? INK.accent : '#3a3646', { gold: fore.gold })
}

/** The reveal: a white frame, colour snapping in, a shine for the rare ones. */
export function revealSvg(lead: BattleCard | null, k = ART_K, motion = true): string {
  if (!lead) return framed('', k, '#3a3646')
  const px = spriteOf(lead, 'full')
  let fx = ''
  if (motion) {
    fx += `<g opacity="0">${crisp(rects(flash(px), k))}<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.28;1" dur="${s3(TIMING.flash + 220)}"/></g>`
  }
  if (lead.species === 'mythic' || lead.shiny) {
    for (let i = 0; i < 3; i++) fx += hidden(crisp(rects(sparkles(px, i * 0.21, `${lead.id}/r`, { count: 2, color: 0xfff0a8, reach: 1 }).map((row, y) => row.map((c, x) => (px[y]![x] === T ? c : T))), k)), loopShown(i * 300, i * 300 + 220, 900))
  }
  if (lead.rarity === 'legendary' && lead.species !== 'mythic') {
    const ring = glowOutline(px, 0xf2b33d, 0.6).map((row, y) => row.map((c, x) => (px[y]![x] === T ? c : T)))
    fx += `<g>${crisp(rects(ring, k))}<animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite"/></g>`
  }
  return framed(crisp(rects(px, k)) + fx, k, rarityHex(lead), { gold: lead.rarity === 'legendary' })
}

/** A creature at rest on its plate, with an optional twinkle (a win, a caught card). */
export function creatureSvg(px: Pixels, stroke: string, k = ART_K, o: { sparkle?: boolean; alt?: string } = {}): string {
  let fx = ''
  if (o.sparkle) for (let i = 0; i < 2; i++) fx += hidden(crisp(rects(sparkles(px, i * 0.3, `rest/${i}`, { count: 2, color: 0xfff0a8, reach: 1 }).map((row, y) => row.map((c, x) => (px[y]![x] === T ? c : T))), k)), loopShown(i * 700, i * 700 + 260, 1400))
  return framed(crisp(rects(px, k)) + fx, k, stroke)
}

/** The catch, from the spin to the result (or holding on the wobbling card while it is undecided). */
export function catchSvg(card: BattleCard, result: 'pending' | 'caught' | 'slipped', start: number, k = ART_K): string {
  const px = spriteOf(card, 'full')
  const w = 16
  const cw = 12
  const back = place(cardBack(cw, 16, card.rarity, 0.25, { mythic: card.species === 'mythic' }), w, 16, 2, 0)
  const F = TIMING.spinFrame
  const pre = catchPreMs(card)
  const beats = catchBeats(card)
  const frames: [Pixels, number, number | null][] = [[px, 0, 0], [squash(px, 0.66), 0, F], [squash(px, 0.33), F, 2 * F], [squash(back, 0.4), 2 * F, 3 * F]]
  let body = frames.slice(1).map(([p, a, b]) => hidden(crisp(rects(p, k)), during(a, b, start))).join('')
  const c = `${(w * k) / 2} ${(16 * k) / 2}`
  let wobble = ''
  if (result === 'pending') {
    wobble = `<animateTransform attributeName="transform" type="rotate" values="0 ${c};-9 ${c};9 ${c};-5 ${c};0 ${c};0 ${c}" keyTimes="0;0.15;0.35;0.5;0.6;1" dur="${s3(TIMING.beat)}" begin="${s3(4 * F - start)}" repeatCount="indefinite"/>`
    body += hidden(`<g>${wobble}${crisp(rects(back, k))}</g>`, during(3 * F, null, start))
    return framed(body, k, rarityHex(card))
  }
  for (let i = 0; i < beats; i++) {
    wobble += `<animateTransform attributeName="transform" type="rotate" values="0 ${c};-9 ${c};9 ${c};-5 ${c};0 ${c};0 ${c}" keyTimes="0;0.15;0.35;0.5;0.6;1" begin="${s3(4 * F + i * TIMING.beat - start)}" dur="${s3(TIMING.beat)}"/>`
  }
  body += hidden(`<g>${wobble}${crisp(rects(back, k))}</g>`, during(3 * F, pre, start))
  body += hidden(crisp(rects(squash(back, 0.4), k)), during(pre, pre + F, start))
  body += hidden(crisp(rects(squash(px, 0.5), k)), during(pre + F, pre + 2 * F, start))
  if (result === 'caught') {
    let burst = ''
    for (let i = 0; i < 4; i++) burst += hidden(crisp(rects(sparkles(px, i * 0.2, 'gotcha', { count: 5, color: 0xfff0a8, reach: 2 }).map((row, y) => row.map((v, x) => (px[y]![x] === T ? v : T))), k)), during(pre + 2 * F + i * 200, pre + 2 * F + i * 200 + 200, start))
    body += hidden(crisp(rects(px, k)) + burst, during(pre + 2 * F, null, start))
  } else {
    const run = pre + 2 * F + 450
    body += hidden(`<g>${crisp(rects(px, k))}${`<animateTransform attributeName="transform" type="translate" values="0 0;${w * k} 0" begin="${s3(run - start)}" dur="0.4s" fill="freeze"/>`}<animate attributeName="opacity" values="1;0" begin="${s3(run - start)}" dur="0.4s" fill="freeze"/></g>`, during(pre + 2 * F, null, start))
  }
  return framed(body, k, rarityHex(card))
}

/** The evolution: the creature and a white silhouette of its next stage trade places, faster, then a flash. */
export function evolveSvg(from: Pixels, to: Pixels, start: number, stroke: string, k = ART_K): string {
  const switches = evolveSwitches()
  let values = '', times = ''
  let last: boolean | null = null
  for (const [t, next] of switches) {
    if (next === last) continue
    values += (values ? ';' : '') + (next ? 'visible' : 'hidden')
    times += (times ? ';' : '') + (t / TIMING.evolve).toFixed(4)
    last = next
  }
  const alt = `<animate attributeName="visibility" calcMode="discrete" values="${values}" keyTimes="${times}" begin="${s3(-start)}" dur="${s3(TIMING.evolve)}" fill="freeze"/>`
  const white = `<g visibility="hidden">${alt}${crisp(rects(silhouette(to, 0xffffff), k))}<set attributeName="visibility" to="hidden" begin="${s3(TIMING.evolve - start)}"/></g>`
  const before = hidden(crisp(rects(from, k)), during(0, TIMING.evolve, start))
  const bright = hidden(crisp(rects(flash(to), k)), during(TIMING.evolve, TIMING.evolve + TIMING.evolveFlash, start))
  let after = crisp(rects(to, k))
  for (let i = 0; i < 4; i++) after += hidden(crisp(rects(sparkles(to, i * 0.2, 'evolved', { count: 4, color: 0xfff0a8, reach: 2 }).map((row, y) => row.map((v, x) => (to[y]![x] === T ? v : T))), k)), during(TIMING.evolve + TIMING.evolveFlash + i * 250, TIMING.evolve + TIMING.evolveFlash + i * 250 + 250, start))
  return framed(before + white + bright + hidden(after, during(TIMING.evolve + TIMING.evolveFlash, null, start)), k, stroke)
}

/** A Mythic gone into the static. */
export function fledSvg(card: BattleCard, start: number, motion: boolean, k = ART_K): string {
  const px = spriteOf(card, 'full')
  if (!motion) return framed(crisp(rects(dissolve(px, 0.9, card.id), k)), k, MYTHIC_COLOR)
  const steps = 6
  let body = ''
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TIMING.fled
    // the last few specks linger
    body += hidden(crisp(rects(dissolve(px, Math.min(0.9, (i + 1) / steps), card.id), k)), during(t, i === steps - 1 ? null : t + TIMING.fled / steps, start))
  }
  return framed(body, k, MYTHIC_COLOR)
}

/** The welcome: the pane's egg wobbles, cracks and hatches. */
export function hatchSvg(creature: Pixels | null, family: Family | null, motion: boolean, k = ART_K): string {
  const speck = eggSpeck(family)
  const egg = eggPixels(speck, 0, 0)
  const c = `${8 * k} ${16 * k}`
  if (!motion) return framed(crisp(rects(creature ?? egg, k)), k, INK.accent)
  const wob = `<animateTransform attributeName="transform" type="rotate" values="0 ${c};-8 ${c};8 ${c};0 ${c};0 ${c}" keyTimes="0;0.1;0.25;0.35;1" dur="0.6s" repeatCount="2"/>`
  const cracks = hidden(crisp(rects(eggPixels(speck, 1, 0), k)), during(1200, 1350, 0)) + hidden(crisp(rects(eggPixels(speck, 2, 0), k)), during(1350, null, 0))
  const shell = `<g>${hidden(`<g>${wob}${crisp(rects(egg, k))}</g>`, during(0, 1200, 0))}${cracks}<set attributeName="visibility" to="hidden" begin="1.5s"/></g>`
  if (!creature) return framed(shell, k, INK.accent)
  const pop = hidden(crisp(rects(creature, k)) + `<animateTransform attributeName="transform" type="scale" values="0.7;1.08;1" dur="0.35s" begin="1.5s" additive="sum"/>`, during(1500, null, 0))
  const shine = hidden(crisp(rects(flash(creature), k)), during(1500, 1500 + TIMING.flash, 0))
  let burst = ''
  for (let i = 0; i < 4; i++) burst += hidden(crisp(rects(sparkles(creature, i * 0.2, 'hatch', { count: 4, color: 0xfff0a8, reach: 2 }).map((row, y) => row.map((v, x) => (creature[y]![x] === T ? v : T))), k)), during(1600 + i * 220, 1600 + i * 220 + 220, 0))
  return framed(shell + pop + shine + burst, k, INK.accent)
}

/** A pack waiting: the pane's package in the family colour, with a soft glow. */
export function packSvg(family: Family, k = ART_K): string {
  const p = packagePixels(family, 0)
  const ring = glowOutline(p, 0xf2b33d, 0.6).map((row, y) => row.map((c, x) => (p[y]![x] === T ? c : T)))
  return framed(crisp(rects(p, k)) + `<g>${crisp(rects(ring, k))}<animate attributeName="opacity" values="0.2;0.9;0.2" dur="1.6s" repeatCount="indefinite"/></g>`, k, FAMILY_COLOR[family])
}

/** The pane's wrapped present, wobbling hopefully now and then. */
export function presentSvg(k = ART_K): string {
  const p = presentPixels(0)
  const c = `${8 * k} ${16 * k}`
  const wob = `<animateTransform attributeName="transform" type="rotate" values="0 ${c};-7 ${c};7 ${c};-4 ${c};0 ${c};0 ${c}" keyTimes="0;0.06;0.12;0.18;0.24;1" dur="1.6s" repeatCount="indefinite"/>`
  return framed(`<g>${wob}${crisp(rects(p, k))}</g>`, k, '#9a8cf0')
}

/** A creature as a small static plate: the catch choice's options. */
export function optionSvg(card: BattleCard, k = 2): string {
  return framed(crisp(rects(spriteOf(card, 'full'), k)), k, rarityHex(card))
}

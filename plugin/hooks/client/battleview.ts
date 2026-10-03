// The band's view models (SPEC 9, 13, 14): what a battle and every band ceremony show, as pure functions of the
// state and of the time inside a moment. The band draws each moment's resting frame from these, and the scheduler
// blits the same frames over time, so a redraw and a blit always agree. Their beats are anim.ts's TIMING, so the
// terminal's frames and the desktop's SMIL tell one story.
import type { BattleAction, BattleCard, BattleLog, Card, Family, Stats } from '../core/types.ts'
import { cardStats } from '../core/cards.ts'
import { ECONOMY } from '../core/economy.ts'
import { FAMILY_INFO, SPECIALS } from '../core/families.ts'
import { MOTE_A, MOTE_B, miniSprite, spriteFor } from '../core/sprite.ts'
import type { Pixels, SpriteSource } from '../core/sprite.ts'
import { TRAITS } from '../core/traits.ts'
import { RULE_INFO } from '../core/world.ts'
import { FAMILY_COLOR, FAMILY_MARK, INK, MARK, MYTHIC_COLOR, RARITY_COLOR, RARITY_WORD, hexInt, hpColor } from '../ui/tokens.ts'
import {
  T, TIMING, blank, cardBack, clamp01, dissolve, easeIn, easeOut, encodeGrid, flash, glowOutline, grid, mix, offset, place,
  putPixels, putText, silhouette, sparkles, squash, tint,
} from './anim.ts'
import type { Grid } from './anim.ts'
import { battleLog, nameOf, opponentLabel, perfectRound, rarestIndex } from './game.ts'
import type { BandState, Battle, Moment, Outcome } from './types.ts'
import { dots, fit, safe } from './text.ts'

export type Side = 'a' | 'd'
const other = (s: Side): Side => (s === 'a' ? 'd' : 'a')

/** How long a moment's ceremony shows the evolving stage plus the result, from its start. */
export const EVOLVE_SHOW = TIMING.evolve + TIMING.evolveHold
const RESULT_MS = ECONOMY.battle.resultBandMs

// ---------- layout ----------

/** From this many columns the battle shows both creatures beside their stats, the story in between. */
export const WIDE_MIN = 76
/** Cells of stats beside a creature in the wide battle. */
export const INFO = 16
export const MINI = 8

export type BandKind = 'wide' | 'narrow'
export const bandKind = (columns: number): BandKind => (columns >= WIDE_MIN ? 'wide' : 'narrow')

let drawn: { columns: number; surface: string } = { columns: 0, surface: '' }
let draws = 0
/** The band notes each drawing, so the scheduler blits Rasters of the size it mounted, and again after a redraw. */
export function noteLayout(columns: number, surface: string): void {
  drawn = { columns, surface }
  draws++
}
export function drawnLayout(): { columns: number; surface: string } {
  return drawn
}
/** How many times the band has drawn: a redraw puts back resting frames, so blits start over. */
export const drawCount = () => draws

// ---------- art ----------

const art = new Map<string, Pixels>()

function artKey(c: SpriteSource & { species?: string; dna?: number }, mini: boolean): string {
  const s = c as Partial<Card>
  const f = s.form
  const formKey = f ? `${f.kind}:${f.seed ?? ''}:${f.parents?.join('+') ?? ''}:${f.names[0]}:${f.hue}:${f.body}` : ''
  return `${s.species}|${formKey}|${s.dna}|${s.stage}|${s.shiny ? 1 : 0}|${s.rarity}|${s.raisedIn ?? ''}|${mini ? 'm' : 'c'}`
}

/** A card's sprite: the 8x8 mini (terminal band) or the 16x16 sprite (desktop band); clear when it cannot be drawn. */
export function spriteOf(c: Pick<Card, 'species' | 'form' | 'dna' | 'shiny' | 'rarity' | 'stage' | 'raisedIn'>, size: 'mini' | 'full'): Pixels {
  const mini = size === 'mini'
  const key = artKey(c, mini)
  let px = art.get(key)
  if (!px) {
    try {
      px = spriteFor(c as SpriteSource)
      if (mini) px = miniSprite(px)
    } catch {
      px = blank(mini ? MINI : 16, mini ? MINI : 16)
    }
    if (art.size >= 300) art.clear()
    art.set(key, px)
  }
  return px
}

/** 8x8 pixel art from rows of letters ('.' is clear). */
function sketch(rows: readonly string[], ink: Record<string, number>): Pixels {
  return rows.map(r => Array.from(r, ch => (ch === '.' ? T : ink[ch] ?? T)))
}

// The terminal band's minis of the egg, the pack and the present, in the colours of the 16x16 pieces the pane and the
// desktop band draw (ui/ceremony-art.tsx). Drawn by hand: a 16x16 picture halved loses its shape at 8x8.

const EGG_ROWS = ['..kkkk..', '.kwwhwk.', 'kwwwwhwk', 'kwswwwwk', 'kwwwwswk', 'kswwwwwk', '.kwwwwk.', '..kkkk..'] as const
const CRACK_ROWS = ['........', '........', '........', '.c...c..', '..c.c.c.', '...c...c', '........', '........'] as const

export function eggArt(family: Family | null): Pixels {
  const spot = family ? hexInt(FAMILY_COLOR[family]) : 0xc9b48a
  return sketch(EGG_ROWS, { k: 0x6b5a48, w: 0xf3ead8, h: 0xffffff, s: spot })
}

export function crackArt(): Pixels {
  return sketch(CRACK_ROWS, { c: 0x4a3c30 })
}

export function packArt(family: Family): Pixels {
  const f = hexInt(FAMILY_COLOR[family])
  return sketch(['.zZzZzZ.', '.kffffk.', '.khfffk.', '.kf**fk.', '.kf**fk.', '.kfffhk.', '.kffffk.', '.zZzZzZ.'],
    { k: mix(f, 0x000000, 0.55), f, h: mix(f, 0xffffff, 0.5), z: mix(f, 0xffffff, 0.25), Z: mix(f, 0x000000, 0.2), '*': 0xf2c445 })
}

export function presentArt(): Pixels {
  return sketch(['.r....r.', '..r..r..', 'kkkrrkkk', 'kbbrrbbk', 'kbBrrbBk', 'kbbrrbbk', 'kBbrrBbk', 'kkkkkkkk'],
    { k: 0x9a3a36, b: 0xc9504a, B: 0xe58a80, r: 0xf2b33d })
}

// ---------- the battle ----------

export type Fighter = {
  side: Side
  slot: number
  card: BattleCard
  name: string
  hp: number
  maxHp: number
  charge: number
  need: number
  special: string
}

function fighter(b: Battle, log: BattleLog | null, side: Side, slot: number, hp: number | undefined, charge: number): Fighter | null {
  const team = side === 'a' ? b.setup.attacker : b.setup.defender
  const card = team[slot] as BattleCard | undefined
  if (!card) return null
  const maxHp = log?.maxHp[side][slot] ?? card.stats.hp
  const quick = card.traits.includes('quickCharge') || (b.setup.rule === 'fableDay' && card.family === 'fable')
  return {
    side, slot, card, name: nameOf(card), hp: Math.max(0, Math.min(maxHp, hp ?? maxHp)), maxHp,
    charge, need: quick ? 1 : ECONOMY.battle.chargeNeed, special: SPECIALS[FAMILY_INFO[card.family].special].name,
  }
}

/** The slot of `side` that fell last, up to round n: who stays on screen once a team is out. */
function lastSlot(log: BattleLog, side: Side, n: number): number {
  for (let r = n - 1; r >= 0; r--) {
    const acts = log.rounds[r]?.actions ?? []
    for (let i = acts.length - 1; i >= 0; i--) {
      const x = acts[i]!
      return x.side === side ? x.slot : x.targetSlot
    }
  }
  return 0
}

/** The two creatures facing off at the start of round r (1-based); past the last round, as the battle ended. */
export function fightersAt(b: Battle, log: BattleLog | null, r: number): { a: Fighter | null; d: Fighter | null } {
  if (!log || r <= 1 || log.rounds.length === 0) return { a: fighter(b, log, 'a', 0, undefined, 0), d: fighter(b, log, 'd', 0, undefined, 0) }
  const n = Math.min(r - 1, log.rounds.length)
  const prev = log.rounds[n - 1]!
  const pick = (side: Side) => {
    const slot = prev.active[side] >= 0 ? prev.active[side] : lastSlot(log, side, n)
    return fighter(b, log, side, slot, prev.hp[side][slot], prev.charge[side][slot] ?? 0)
  }
  return { a: pick('a'), d: pick('d') }
}

/** What the battle shows: the server's log when rules differ (null until it is in), else the live simulation. */
export function logOf(b: Battle): BattleLog | null {
  return battleLog(b) as BattleLog | null
}

/** The round on screen: the one being animated (shown + 1), or the last once every round is in. */
export function roundOnScreen(b: Battle, log: BattleLog | null): number {
  if (!log) return 1
  return Math.min(b.shown + 1, Math.max(1, log.rounds.length))
}

export type Hit = { action: BattleAction; at: number; actor: Side; target: Side; before: { a: number; d: number }; after: { a: number; d: number } }

export type RoundPlan = {
  round: number
  /** how long the round plays: its pace, or longer when a knock-out needs the time */
  ms: number
  hits: Hit[]
  start: { a: number; d: number }
  end: { a: number; d: number }
  /** when round-end healing (Regrowth, Sonnet Day) settles the bars on the log's numbers */
  endAt: number
  fighters: { a: Fighter | null; d: Fighter | null }
  /** a new creature stepped in at the start of this round */
  stepIn: { a: boolean; d: boolean }
}

/**
 * One round's beats. Actions land at fixed points of the pace; when the attacker's special opens a live round it
 * lands later, so `[1] Now!` has a fair moment before the blow.
 */
export function roundPlan(b: Battle, log: BattleLog, r: number, paceMs: number): RoundPlan | null {
  const round = log.rounds[r - 1]
  if (!round) return null
  const f = fightersAt(b, log, r)
  const prev = r > 1 ? fightersAt(b, log, r - 1) : null
  const max = { a: f.a?.maxHp ?? 0, d: f.d?.maxHp ?? 0 }
  const hp = { a: f.a?.hp ?? 0, d: f.d?.hp ?? 0 }
  const start = { ...hp }
  const P = Math.max(1200, paceMs)
  const first = round.actions[0]
  const late = b.live && first?.side === 'a' && first.move === 'special'
  const fractions = late ? [0.5, 0.8] : [0.24, 0.64]
  const hits: Hit[] = round.actions.map((x, i) => {
    const at = Math.round(P * fractions[Math.min(i, 1)]!)
    const actor = x.side, target = other(actor)
    const before = { ...hp }
    hp[target] = Math.max(0, hp[target] - x.dmg)
    hp[actor] = Math.min(max[actor], hp[actor] + x.heal)
    return { action: x, at, actor, target, before, after: { ...hp } }
  })
  const end = { a: f.a ? round.hp.a[f.a.slot] ?? hp.a : 0, d: f.d ? round.hp.d[f.d.slot] ?? hp.d : 0 }
  const last = hits.at(-1)
  const endAt = (last?.at ?? Math.round(P * 0.4)) + TIMING.drain + 120
  const ko = hits.some(h => h.action.targetFainted)
  const ms = Math.max(P, ko && last ? last.at + TIMING.ko + 250 : 0, endAt + TIMING.drain)
  return {
    round: r, ms, hits, start, end, endAt, fighters: f,
    stepIn: { a: !!prev && !!f.a && prev.a?.slot !== f.a.slot, d: !!prev && !!f.d && prev.d?.slot !== f.d.slot },
  }
}

export type Popup = { text: string; color: number; age: number }
export type Callout = { text: string; color: number }

/** One creature's look at a moment of its round. */
export type FighterLook = {
  hp: number
  dx: number
  dy: number
  flash: boolean
  hidden: boolean
  gone: boolean
  popup: Popup | null
  callout: Callout | null
  glow: number
  glowColor: number
  sparkle: boolean
  t: number
}

const GOLD = hexInt(INK.accent)
const BAD = hexInt(INK.bad)
const GOOD = hexInt(INK.good)
const MUTED = hexInt(INK.muted)
const SUPER = 0xffd27a

export const restLook = (hp: number, gone = false): FighterLook => ({
  hp, dx: 0, dy: 0, flash: false, hidden: false, gone, popup: null, callout: null, glow: 0, glowColor: 0, sparkle: false, t: 0,
})

/** The callouts a hit raises, in order, with when each starts and whose they are. */
function calloutsOf(plan: RoundPlan, h: Hit): { side: Side; at: number; c: Callout }[] {
  const x = h.action
  const out: { side: Side; at: number; c: Callout }[] = []
  const actor = plan.fighters[h.actor]
  if (x.move === 'special' && x.special) out.push({ side: h.actor, at: h.at - TIMING.windup, c: { text: `${SPECIALS[x.special].name}!`, color: hexInt(FAMILY_COLOR[actor?.card.family ?? 'sonnet']) } })
  if (x.perfect) out.push({ side: h.actor, at: h.at, c: { text: 'Perfect!', color: GOLD } })
  let t = h.at + 60
  if (x.dmg > 0 && x.crit) { out.push({ side: h.target, at: t, c: { text: 'Critical!', color: GOLD } }); t += 320 }
  if (x.dmg > 0 && x.effect === 'super') { out.push({ side: h.target, at: t, c: { text: 'Super effective!', color: SUPER } }); t += 320 }
  if (x.dmg > 0 && x.effect === 'weak') { out.push({ side: h.target, at: t, c: { text: 'Not very effective…', color: MUTED } }); t += 320 }
  for (const id of x.traits) {
    const owner: Side = actor?.card.traits.includes(id) ? h.actor : h.target
    const card = plan.fighters[owner]?.card
    out.push({ side: owner, at: t, c: { text: `${TRAITS[id]?.name ?? safe(id, 16)}!`, color: hexInt(FAMILY_COLOR[card?.family ?? 'sonnet']) } })
    t += 320
  }
  if (x.targetFainted) out.push({ side: h.target, at: h.at + TIMING.ko, c: { text: 'Fainted', color: MUTED } })
  return out
}

function hpAt(plan: RoundPlan, side: Side, t: number): number {
  let v = plan.start[side]
  for (const h of plan.hits) {
    if (t < h.at) break
    const from = h.before[side], to = h.after[side]
    v = from === to ? to : from + (to - from) * easeOut((t - h.at) / TIMING.drain)
  }
  const settled = plan.hits.at(-1)?.after[side] ?? plan.start[side]
  if (t >= plan.endAt && plan.end[side] !== settled) v = settled + (plan.end[side] - settled) * easeOut((t - plan.endAt) / TIMING.drain)
  return v
}

/** One side's look `t` ms into its round: lunges, flashes, shakes, numbers, callouts, the knock-out. */
export function lookAt(plan: RoundPlan, side: Side, t: number): FighterLook {
  const look = restLook(hpAt(plan, side, t))
  look.t = t
  const toward = side === 'a' ? 1 : -1
  if (plan.stepIn[side] && t < TIMING.stepIn) look.dx = -toward * Math.round((1 - easeOut(t / TIMING.stepIn)) * MINI)
  if (plan.start[side] <= 0) look.gone = true
  let popup: Popup | null = null
  const pop = (text: string, color: number, at: number) => { if (t >= at && t - at < TIMING.popup) popup = { text, color, age: t - at } }
  for (const h of plan.hits) {
    const x = h.action
    if (h.actor === side) {
      if (t >= h.at - TIMING.windup + 40 && t < h.at + 40) look.dx = toward
      if (x.move === 'special' && t >= h.at - 2 * TIMING.windup && t < h.at + 80) {
        look.glow = clamp01((t - (h.at - 2 * TIMING.windup)) / (2 * TIMING.windup))
        look.glowColor = x.perfect ? GOLD : hexInt(FAMILY_COLOR[plan.fighters[side]?.card.family ?? 'sonnet'])
      }
      if (x.perfect && t >= h.at && t < h.at + 700) look.sparkle = true
      if (x.heal > 0) pop(`+${x.heal}`, GOOD, h.at + 120)
    } else {
      const pulses = x.hits > 1 ? [h.at, h.at + 150] : [h.at]
      for (const p of pulses) {
        if (t >= p && t < p + TIMING.hitFlash) look.flash = true
        if (t >= p && t < p + TIMING.shake) look.dx = [-1, 1, -1, 1, 0][Math.floor((t - p) / 45)] ?? 0
      }
      if (x.dmg > 0) pop(`-${x.dmg}${x.crit ? '!' : ''}`, x.crit ? GOLD : BAD, h.at)
      if (x.targetFainted) {
        const k = h.at + 250
        if (t >= k && t < k + 450) look.hidden = Math.floor((t - k) / 75) % 2 === 1
        else if (t >= k + 450 && t < k + 650) look.dy = Math.ceil(easeIn((t - k - 450) / 200) * 4)
        else if (t >= k + 650) look.gone = true
      }
    }
  }
  const settled = plan.hits.at(-1)?.after[side] ?? plan.start[side]
  if (plan.end[side] > settled) pop(`+${plan.end[side] - settled}`, GOOD, plan.endAt)
  look.popup = popup
  let latest: { at: number; c: Callout } | null = null
  for (const h of plan.hits) for (const c of calloutsOf(plan, h)) if (c.side === side && t >= c.at && (!latest || c.at >= latest.at)) latest = c
  look.callout = latest?.c ?? null
  return look
}

// ---------- terminal cells for a fighter ----------

export type FighterLayout = {
  /** wide: sprite and four rows of stats in one Raster; line: one row of stats; art: the sprite alone */
  kind: 'wide' | 'line' | 'art'
  columns: number
  rows: number
  mirror: boolean
}

export function fighterLayout(kind: 'wide' | 'line' | 'art', side: Side, columns = 0): FighterLayout {
  if (kind === 'wide') return { kind, columns: MINI + 1 + INFO, rows: 4, mirror: side === 'd' }
  if (kind === 'art') return { kind, columns: MINI, rows: MINI / 2, mirror: false }
  return { kind, columns: Math.max(12, columns), rows: 1, mirror: false }
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

/** An HP bar of `cells` cells, 8 steps a cell, so the drain moves smoothly. */
function putBar(g: Grid, x: number, y: number, cells: number, hp: number, max: number): void {
  const f = max > 0 ? clamp01(hp / max) : 0
  const color = hexInt(hpColor(f))
  const eighths = hp > 0 ? Math.max(1, Math.round(f * cells * 8)) : 0
  for (let i = 0; i < cells; i++) {
    const n = Math.max(0, Math.min(8, eighths - i * 8))
    if (n === 8) putText(g, x + i, y, '█', color)
    else if (n > 0) putText(g, x + i, y, EIGHTHS[n]!, color)
    else putText(g, x + i, y, '░', MUTED)
  }
}

const hpText = (hp: number, max: number) => `${Math.max(0, Math.ceil(hp))}/${max}`

/** The sprite with its look applied: glow, lunge or shake, the hit's white frame, a knock-out, sparkles. */
export function lookPixels(px: Pixels, look: FighterLook, seed: string): Pixels | null {
  if (look.gone || look.hidden) return null
  let p = look.glow > 0 ? glowOutline(px, look.glowColor, look.glow) : px
  p = offset(p, look.dx, look.dy)
  if (look.flash) p = flash(p)
  if (look.sparkle) p = sparkles(p, look.t / 1000, seed, { count: 3, color: 0xfff0a8, reach: 1 })
  return p
}

/** A number over the creature: it pops on the lower row, rises a row and fades. */
function putPopup(g: Grid, x0: number, width: number, popup: Popup): void {
  const row = popup.age < 160 ? 1 : 0
  const fade = clamp01((popup.age - 300) / 300)
  const text = popup.text.slice(0, width)
  putText(g, x0 + Math.max(0, Math.floor((width - text.length) / 2)), row, text, mix(popup.color, 0x6b6878, fade), { keepBg: true })
}

/**
 * A fighter as Raster cells: in the wide band its mini and four rows of stats (name and family mark, HP bar and
 * numbers, the latest callout, the special's charge), mirrored for the defender; in the narrow band one stats line,
 * or the mini alone.
 */
export function fighterGrid(f: Fighter | null, look: FighterLook, L: FighterLayout): Grid {
  const g = grid(L.columns, L.rows)
  if (!f) return g
  const seed = `${f.card.id}`
  if (L.kind === 'art' || L.kind === 'wide') {
    const sx = L.kind === 'wide' && L.mirror ? L.columns - MINI : 0
    const px = lookPixels(spriteOf(f.card, 'mini'), look, seed)
    if (px) putPixels(g, px, sx, 0)
    if (look.popup) putPopup(g, sx, MINI, look.popup)
  }
  if (L.kind === 'art') return g
  const rarity = hexInt(f.card.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[f.card.rarity])
  const fam = hexInt(FAMILY_COLOR[f.card.family])
  const nameColor = look.flash ? 0xffffff : f.hp <= 0 && look.hp <= 0 ? MUTED : rarity
  if (L.kind === 'line') {
    const digits = hpText(look.hp, f.maxHp)
    const tail = 1 + 8 + 1 + digits.length
    const nameW = Math.max(3, Math.min(10, L.columns - tail - 5))
    const name = fit(f.name, nameW)
    putText(g, 0, 0, name, nameColor)
    const bx = nameW + 1
    putBar(g, bx, 0, 8, look.hp, f.maxHp)
    putText(g, bx + 9, 0, digits, MUTED)
    if (look.popup && look.popup.age < TIMING.popup) {
      putText(g, bx + 10 + digits.length, 0, look.popup.text.slice(0, 5), mix(look.popup.color, 0x6b6878, clamp01((look.popup.age - 300) / 300)))
    }
    return g
  }
  const x0 = L.mirror ? 0 : MINI + 1
  const right = (row: number, text: string, color: number) => putText(g, L.mirror ? x0 + INFO - Array.from(text).length : x0, row, text, color)
  const name = fit(f.name, INFO - 2)
  if (L.mirror) {
    putText(g, x0 + INFO - name.length - 2, 0, FAMILY_MARK[f.card.family], fam)
    putText(g, x0 + INFO - name.length, 0, name, nameColor)
  } else {
    putText(g, x0, 0, name, nameColor)
    putText(g, x0 + name.length + 1, 0, FAMILY_MARK[f.card.family], fam)
  }
  const digits = hpText(look.hp, f.maxHp)
  const bx = L.mirror ? x0 + INFO - 8 : x0
  putBar(g, bx, 1, 8, look.hp, f.maxHp)
  if (L.mirror) putText(g, bx - 1 - digits.length, 1, digits, MUTED)
  else putText(g, bx + 9, 1, digits, MUTED)
  if (look.callout) right(2, fit(look.callout.text, INFO), look.callout.color)
  const ready = f.charge >= f.need
  right(3, `${fit(f.special, INFO - 1 - f.need)} ${'●'.repeat(Math.min(f.need, f.charge))}${'○'.repeat(Math.max(0, f.need - f.charge))}`, ready ? GOLD : MUTED)
  return g
}

export function fighterCells(f: Fighter | null, look: FighterLook, L: FighterLayout): { columns: number; rows: number; cells: string } {
  const g = fighterGrid(f, look, L)
  return { columns: g.columns, rows: g.rows, cells: encodeGrid(g) }
}

/** Raster keys of the battle band, as it draws them. */
export const KEYS = {
  a: 'band-a', d: 'band-d', aLine: 'band-a-line', dLine: 'band-d-line', dArt: 'band-d-art', lead: 'band-lead', art: 'band-art',
  option: (i: number) => `band-option-${i}`,
} as const

/** Every fighter Raster of a battle frame for a band `columns` wide: key to cells. */
export function fightCells(f: { a: Fighter | null; d: Fighter | null }, looks: { a: FighterLook; d: FighterLook }, columns: number): Map<string, string> {
  const out = new Map<string, string>()
  if (bandKind(columns) === 'wide') {
    out.set(KEYS.a, fighterCells(f.a, looks.a, fighterLayout('wide', 'a')).cells)
    out.set(KEYS.d, fighterCells(f.d, looks.d, fighterLayout('wide', 'd')).cells)
  } else {
    const w = lineWidth(columns)
    out.set(KEYS.dArt, fighterCells(f.d, looks.d, fighterLayout('art', 'd')).cells)
    out.set(KEYS.aLine, fighterCells(f.a, looks.a, fighterLayout('line', 'a', w)).cells)
    out.set(KEYS.dLine, fighterCells(f.d, looks.d, fighterLayout('line', 'd', w)).cells)
  }
  return out
}

/** The narrow band's stats line: everything right of the defender's mini. */
export const lineWidth = (columns: number) => Math.max(12, columns - MINI - 1)

// ---------- the battle's words ----------

/** A run of text in one style; a line is a list of them. */
export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }
export type Line = Seg[]

const rarityColorOf = (c: Pick<BattleCard, 'species' | 'rarity'>) => (c.species === 'mythic' ? MYTHIC_COLOR : RARITY_COLOR[c.rarity])

export function rarityWords(c: Pick<BattleCard, 'species' | 'rarity' | 'shiny' | 'foil'>): string {
  const word = c.species === 'mythic' ? 'Mythic' : RARITY_WORD[c.rarity]
  return dots(word, c.shiny && c.foil ? 'Shiny Foil' : c.shiny ? 'Shiny' : c.foil ? 'Foil' : '')
}

/** What the rustle foreshadows (SPEC 13.2): rare twinkles, epic shimmers, shiny glints, the roamer turns the air gold. */
export type Foreshadow = { twinkle: boolean; shimmer: boolean; glint: boolean; gold: boolean; mythic: boolean }

export function foreshadowOf(lead: Pick<BattleCard, 'species' | 'rarity' | 'shiny'> | null): Foreshadow {
  const mythic = lead?.species === 'mythic'
  return {
    twinkle: lead?.rarity === 'rare', shimmer: lead?.rarity === 'epic', glint: !!lead?.shiny,
    gold: !mythic && lead?.rarity === 'legendary', mythic,
  }
}

/** The rustle runs 1.5 to 3 s, longer when rarer (SPEC 14); a duel's call is short. */
export function rustleMs(b: Battle): number {
  if (b.setup.kind === 'duel') return TIMING.duelIntro
  const lead = b.setup.defender[0]
  if (!lead) return 1500
  const base = lead.species === 'mythic' || lead.rarity === 'legendary' ? 3000 : lead.rarity === 'epic' ? 2500 : lead.rarity === 'rare' ? 2000 : 1500
  return Math.min(3000, base + (lead.shiny ? 500 : 0))
}

export const revealHoldMs = (b: Battle) => (b.setup.kind === 'duel' ? TIMING.duelHold : TIMING.revealHold)

const arenaWords = (b: Battle) => dots(`${FAMILY_INFO[b.setup.arena].name} arena`, b.setup.rule !== 'calm' && RULE_INFO[b.setup.rule].name)

/** `vs soft-otter-42 · Opus arena · Haiku Day · round 3` (SPEC 9); the rustle names no one yet. */
export function battleHeader(b: Battle, round: number | null): string {
  if (b.phase === 'rustle') return arenaWords(b)
  const lead = b.setup.defender[0] ?? null
  return dots(`vs ${opponentLabel(b.opponent, lead)}`, arenaWords(b), round !== null && `round ${round}`)
}

/** `streak 2 · one more!` while a streak runs (SPEC 14). */
export function streakWords(streak: number): string {
  if (streak <= 0) return ''
  return (streak + 1) % ECONOMY.streak.every === 0 ? `streak ${streak} · one more!` : `streak ${streak}`
}

export type BattleWords = {
  header: string
  /** the moment's main line: the rustle, the reveal, a special, a Perfect, the result */
  banner: Line
  /** a smaller second line: rarity and badges, step-ins, the streak */
  extra: Line
  /** `[1] Now!` is live for this round */
  now: boolean
  round: number | null
}

/** The battle's words for the state on screen. */
export function battleWords(b: Battle, state: Pick<BandState, 'me' | 'signals' | 'account' | 'cards'>): BattleWords {
  const log = logOf(b)
  const lead = b.setup.defender[0] ?? null
  const label = opponentLabel(b.opponent, lead)
  const streak = streakWords(state.me?.player.streak ?? 0)
  if (b.phase === 'rustle') {
    const fore = foreshadowOf(lead)
    const banner: Line = b.setup.kind === 'duel' ? [{ text: `${label} wants to battle!`, bold: true }]
      : fore.gold ? [{ text: 'The air feels different…', color: INK.accent, bold: true }]
      : fore.mythic ? [{ text: 'Something strange stirs…', color: MYTHIC_COLOR, bold: true }]
      : [{ text: 'Something is rustling…', bold: true }]
    const extra: Line = b.setup.kind === 'duel' && b.opponent.kind !== 'wild' ? [{ text: `${b.opponent.league} league`, dim: true }] : [{ text: 'while Claude works', dim: true }]
    return { header: battleHeader(b, null), banner, extra, now: false, round: null }
  }
  if (b.phase === 'reveal' || !lead) {
    const name = lead ? nameOf(lead) : '?'
    const color = lead ? rarityColorOf(lead) : undefined
    let banner: Line
    if (b.setup.kind === 'duel') banner = [{ text: `${label} sent out ` }, { text: name, color, bold: true }, { text: '!' }]
    else if (lead?.species === 'mythic') banner = [{ text: 'A Mythic appeared! ' }, { text: name, color: MYTHIC_COLOR, bold: true }]
    else if (lead?.rarity === 'legendary') banner = [{ text: 'The roaming ' }, { text: name, color: INK.accent, bold: true }, { text: ' appeared!' }]
    else banner = [{ text: 'A wild ' }, { text: name, color, bold: true }, { text: ' appeared!' }]
    const extra: Line = []
    if (lead) extra.push({ text: rarityWords(lead), color })
    const seen = state.me?.player.seen ?? []
    if (lead && /^s\d/.test(lead.species) && !seen.includes(lead.species)) extra.push({ text: ' NEW', color: INK.accent, bold: true })
    if (b.firstPossible[0] && state.account.world === 'online') extra.push({ text: ` ${MARK.first} FIRST IN THE WORLD?`, color: INK.accent, bold: true })
    const more = b.setup.defender.length - 1
    if (more > 0) extra.push({ text: ` · and ${more} more`, dim: true })
    return { header: battleHeader(b, null), banner, extra, now: false, round: null }
  }
  if (!log) {
    return { header: battleHeader(b, null), banner: [{ text: 'Sizing each other up…', bold: true }], extra: streak ? [{ text: streak, dim: true }] : [], now: false, round: null }
  }
  const over = b.shown >= log.rounds.length
  if (b.phase === 'finishing' || over) {
    const banner: Line = log.result === 'win' ? [{ text: 'Victory!', color: INK.accent, bold: true }]
      : log.result === 'draw' ? [{ text: 'A draw!', bold: true }] : [{ text: 'Your team gave it everything', bold: true }]
    return { header: battleHeader(b, log.rounds.length), banner, extra: [{ text: 'Counting up…', dim: true }], now: false, round: log.rounds.length }
  }
  const r = Math.max(1, b.shown + 1)
  const round = log.rounds[r - 1]
  if (!round) return { header: battleHeader(b, null), banner: [], extra: [], now: false, round: null }
  const f = fightersAt(b, log, r)
  const now = perfectRound(b) === r
  const pressed = b.inputs.includes(r)
  let banner: Line = []
  const aSpecial = round.actions.find(x => x.side === 'a' && x.move === 'special')
  const dSpecial = round.actions.find(x => x.side === 'd' && x.move === 'special')
  const said = (fx: Fighter | null, x: BattleAction) => [{ text: fx?.name ?? '?', color: fx ? rarityColorOf(fx.card) : undefined, bold: true }, { text: ` used ${x.special ? SPECIALS[x.special].name : 'its special'}!` }]
  if (aSpecial) {
    if (pressed) banner = [{ text: 'Perfect! ', color: INK.accent, bold: true }, ...said(f.a, aSpecial)]
    else if (now) banner = [{ text: `${f.a?.special ?? 'The special'} is ready!`, color: INK.accent, bold: true }]
    else banner = said(f.a, aSpecial)
  }
  if (dSpecial) banner = banner.length ? [...banner, { text: ' · ', dim: true }, ...said(f.d, dSpecial)] : said(f.d, dSpecial)
  const prev = r > 1 ? fightersAt(b, log, r - 1) : null
  const extra: Line = []
  if (r === 1 && b.subs.length > 0) {
    // "Tuftbun stepped in for Pipkin" (SPEC 5): a tired or missing slot filled at the start
    const s = b.subs[0]!
    const card = b.setup.attacker[s.slot]
    const gone = s.replaced ? state.cards.find(c => c.id === s.replaced) : undefined
    if (card) extra.push({ text: `${nameOf(card)} stepped in${gone ? ` for ${nameOf(gone)}` : ''}`, dim: true })
  }
  if (prev && f.a && prev.a?.slot !== f.a.slot) extra.push({ text: `Go, ${f.a.name}!`, dim: true })
  if (prev && f.d && prev.d?.slot !== f.d.slot) extra.push({ text: `${b.opponent.kind === 'wild' ? 'Another wild ' : ''}${f.d.name} ${b.opponent.kind === 'wild' ? 'joined in!' : 'stepped in!'}`, dim: true })
  if (extra.length === 0 && streak) extra.push({ text: streak, dim: true })
  return { header: battleHeader(b, r), banner, extra: join(extra), now, round: r }
}

const join = (l: Line): Line => l.flatMap((s, i) => (i === 0 ? [s] : [{ text: ' · ', dim: true }, s]))

// ---------- ceremony frames (pixels; t in ms since the stage began) ----------

/** A shadow light enough to read on a dark terminal and still a shadow on a light one; its rim a touch lighter. */
export const SHADOW = 0x4a4560
const RIM = 0x625c7e
const edgeOf = (px: Pixels, x: number, y: number) => px[y]?.[x] !== undefined && px[y]![x] !== T
  && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (px[y + dy!]?.[x + dx!] ?? T) === T)

/** The rustle: a dark silhouette wobbling in bursts, with the rarity's foreshadowing on it. */
export function rustleFrame(px: Pixels, fore: Foreshadow, t: number, seed: string): Pixels {
  const burst = t % 900 < 520
  const dx = burst ? [0, -1, 0, 1][Math.floor(t / 90) % 4]! : 0
  const s = offset(silhouette(px, SHADOW), dx, 0)
  const w = s[0]?.length ?? 0, h = s.length
  const out = s.map(r => r.slice())
  const edges: [number, number][] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edgeOf(s, x, y)) edges.push([x, y])
  const pulse = 0.5 + 0.5 * Math.sin(t / 160)
  for (const [x, y] of edges) out[y]![x] = RIM
  if (fore.shimmer || fore.gold) {
    const color = fore.gold ? 0xf2b33d : 0xb06ef3
    for (const [x, y] of edges) out[y]![x] = mix(SHADOW, color, 0.45 + 0.5 * pulse)
  }
  if (fore.mythic) {
    const frame = Math.floor(t / 70)
    for (const [x, y] of edges) {
      const n = (x * 7 + y * 13 + frame * 5) % 9
      if (n === 0) out[y]![x] = 0xe8e6f0
      else if (n === 1) out[y]![x] = 0xff7ac6
    }
  }
  if (fore.twinkle && edges.length > 0 && t % 800 < 260) {
    const [x, y] = edges[(seed.length * 7) % edges.length]!
    out[y]![x] = 0xffffff
  }
  if (fore.glint) {
    const k = ((t % 1400) / 1400) * (w + h + 4) - 2
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[y]![x] !== T && Math.abs(x + y - k) < 0.8) out[y]![x] = 0xfff4c2
  }
  return out
}

/** The reveal: one white frame, then colour snapping in; shinies and Mythics sparkle, legendaries glow gold. */
export function revealFrame(px: Pixels, lead: Pick<BattleCard, 'species' | 'rarity' | 'shiny'> | null, t: number, seed: string): Pixels {
  if (t < TIMING.flash) return flash(px)
  let p = t < TIMING.flash + 220 ? tint(px, 0xffffff, 1 - easeOut((t - TIMING.flash) / 220)) : px
  if (lead?.species === 'mythic') p = sparkles(p, t / 1000, seed, { count: 3, color: MOTE_A, reach: 1 })
  else if (lead?.rarity === 'legendary') p = glowOutline(p, 0xf2b33d, 0.5 + 0.5 * Math.sin(t / 200))
  if (lead?.shiny) p = sparkles(p, t / 1000 + 0.3, `${seed}/shiny`, { count: 2, color: MOTE_B, reach: 1 })
  return p
}

export const catchBeats = (c: Pick<BattleCard, 'species' | 'rarity'>) => (c.species === 'mythic' || c.rarity === 'legendary' || c.rarity === 'epic' ? 3 : c.rarity === 'rare' ? 2 : 1)
export const catchSpinMs = 4 * TIMING.spinFrame
/** From the spin's start to the result: 4 squash frames and the wobble beats. */
export const catchPreMs = (c: Pick<BattleCard, 'species' | 'rarity'>) => catchSpinMs + catchBeats(c) * TIMING.beat

function backFor(px: Pixels, c: Pick<BattleCard, 'species' | 'rarity'>, t: number): Pixels {
  const w = px[0]?.length ?? MINI, h = px.length
  const cw = Math.max(4, Math.round(w * 0.75))
  return place(cardBack(cw, h, c.rarity, t / 900, { mythic: c.species === 'mythic' }), w, h, Math.floor((w - cw) / 2), 0)
}

/**
 * The catch (SPEC 13.4): the creature spins into a card in 4 frames, the card wobbles a beat for common, two for rare,
 * three for epic and above; then it pops open with sparkles, or unspins and the creature runs off.
 */
export function catchFrame(px: Pixels, c: Pick<BattleCard, 'species' | 'rarity'>, t: number, result: 'pending' | 'caught' | 'slipped'): Pixels {
  const back = backFor(px, c, t)
  const F = TIMING.spinFrame
  if (t < 4 * F) return [squash(px, 0.66), squash(px, 0.33), squash(back, 0.4), back][Math.floor(t / F)]!
  const pre = catchPreMs(c)
  if (t < pre || result === 'pending') {
    const beat = (t - 4 * F) % TIMING.beat
    return offset(back, beat < 110 ? -1 : beat < 220 ? 1 : beat < 300 ? -1 : 0, 0)
  }
  const tr = t - pre
  if (tr < F) return squash(back, 0.4)
  if (tr < 2 * F) return squash(px, 0.5)
  if (result === 'caught') return tr < TIMING.sparkle ? sparkles(px, tr / 1000, 'gotcha', { count: 5, color: 0xfff0a8, reach: 2 }) : px
  if (tr < 2 * F + 450) return px
  const run = easeIn((tr - 2 * F - 450) / 400)
  return run >= 1 ? silhouette(px, SHADOW) : offset(px, Math.round(run * (px[0]?.length ?? MINI)), 0)
}

/** Which of the evolution's two images shows: the swaps quicken from 1.5 to 12 a second over 3 s. */
export function evolveShowsNext(t: number): boolean {
  const s = Math.max(0, t) / 1000, T3 = TIMING.evolve / 1000
  const phase = 1.5 * s + (3.5 * s ** 3) / (T3 * T3)
  return Math.floor(2 * phase) % 2 === 1
}

/** The evolution's swaps as [ms, next stage shows] from its start, sampled every 10 ms (the desktop's keyTimes). */
export function evolveSwitches(): [number, boolean][] {
  const out: [number, boolean][] = []
  for (let t = 0; t < TIMING.evolve; t += 10) out.push([t, evolveShowsNext(t)])
  return out
}

/** The evolution (SPEC 13.6): the creature alternates with a white silhouette of its next stage, faster, then a flash. */
export function evolveFrame(from: Pixels, to: Pixels, t: number): Pixels {
  if (t < TIMING.evolve) return evolveShowsNext(t) ? silhouette(to, 0xffffff) : from
  if (t < TIMING.evolve + TIMING.evolveFlash) return flash(to)
  const tr = t - TIMING.evolve - TIMING.evolveFlash
  return tr < TIMING.sparkle ? sparkles(to, tr / 1000, 'evolved', { count: 4, color: 0xfff0a8, reach: 2 }) : to
}

/** A Mythic's farewell: gone into the static, a few specks lingering. */
export function fledFrame(px: Pixels, t: number, seed: string): Pixels {
  return dissolve(px, Math.min(0.9, t / TIMING.fled), seed)
}

/** The welcome (SPEC 34): an egg wobbles, cracks and hatches your lead starter. */
export function hatchFrame(creature: Pixels | null, family: Family | null, t: number): Pixels {
  const egg = eggArt(family)
  const w = egg[0]?.length ?? MINI
  if (t < 1200) {
    const p = t % 600
    return offset(egg, p < 100 ? -1 : p < 200 ? 1 : 0, 0)
  }
  const cracked = crackArt()
  const shell = egg.map((r, y) => r.map((c, x) => (cracked[y]?.[x] ?? T) !== T && c !== T ? cracked[y]![x]! : c))
  if (t < 1500 || !creature) return shell
  if (t < 1500 + TIMING.flash) return flash(creature)
  const tr = t - 1500 - TIMING.flash
  const sized = (creature[0]?.length ?? w) === w ? creature : place(creature, w, w, 0, 0)
  return tr < TIMING.sparkle ? sparkles(sized, tr / 1000, 'hatch', { count: 4, color: 0xfff0a8, reach: 2 }) : sized
}

/** A pack ready to open: the family's package, glowing softly. */
export function packFrame(family: Family, t: number): Pixels {
  return glowOutline(packArt(family), 0xf2b33d, 0.35 + 0.35 * Math.sin(t / 260))
}

/** A wrapped present: it gives a hopeful wobble now and then. */
export function presentFrame(t: number): Pixels {
  const p = presentArt()
  const k = t % 1600
  return offset(p, k < 100 ? -1 : k < 200 ? 1 : k < 300 ? -1 : 0, 0)
}

// ---------- the band's moments after a battle ----------

export type OutcomeMoment = Extract<Moment, { kind: 'outcome' }>
export type EvolveMoment = Extract<Moment, { kind: 'evolve' }>

export type OutcomeStage = 'choose' | 'catching' | 'caught' | 'slipped' | 'fled' | 'none'

/** When an outcome's catch result arrived (or the battle settled): its `until` less the result's 12 s. */
export const outcomeAnchor = (m: OutcomeMoment) => (m.until === null ? null : m.until - RESULT_MS)

/** The card a catch ceremony spins: the one caught, else the creature picked, else the wild lead. */
export function catchCard(m: OutcomeMoment): BattleCard | null {
  const c = m.outcome.catch
  if (c.status === 'caught') return c.card
  if (c.status === 'catching') return c.options[c.index] ?? null
  if (c.status === 'choose') return c.options[rarestIndex(c.options)] ?? null
  return m.outcome.lead
}

/**
 * Which stage of the result shows at `now`. A catch whose result is in still shows the spin and the wobble until the
 * beats are over: the server has decided, the animation only adds suspense (SPEC 13.4). Motion off shows the result.
 */
export function outcomeStage(m: OutcomeMoment, now: number, motion: boolean): OutcomeStage {
  const c = m.outcome.catch
  if (c.status === 'choose') return 'choose'
  if (c.status === 'catching') return 'catching'
  if (c.status === 'caught' || c.status === 'slipped') {
    const anchor = outcomeAnchor(m)
    const card = catchCard(m)
    if (motion && anchor !== null && card && now < anchor + catchPreMs(card)) return 'catching'
    return c.status
  }
  if (c.status === 'fled') return 'fled'
  return 'none'
}

export const isMythicCard = (c: Pick<BattleCard, 'species'> | null) => c?.species === 'mythic'

/** `Won vs wild Fogmaw · +10 sparks · rating +12`: the result in one line (SPEC 9). */
export function outcomeSummary(o: Outcome): string {
  const vs = opponentLabel(o.opponent, o.lead)
  const head = o.result === 'win' ? `Won vs ${vs}` : o.result === 'loss' ? `Lost to ${vs}` : `Draw with ${vs}`
  return dots(head, `+${o.sparks} sparks`, o.kind === 'duel' && o.ratingDelta !== 0 && `rating ${o.ratingDelta > 0 ? '+' : ''}${o.ratingDelta}`)
}

/** The badges a result carries, each its own small beat: streak pack, league, Perfects, the daily pack, a bounty. */
export function outcomeBadges(o: Outcome): Line {
  const out: Line = []
  if (o.streakPack) out.push({ text: `Hot streak! x${o.streak} · +1 pack`, color: INK.accent, bold: true })
  if (o.league) {
    const up = ECONOMY.leagues.findIndex(l => l.name === o.league!.to) > ECONOMY.leagues.findIndex(l => l.name === o.league!.from)
    out.push(up ? { text: `${MARK.sparkle} ${o.league.to} league!`, color: INK.accent, bold: true } : { text: `Back to ${o.league.to} league`, dim: true })
  }
  if (o.perfect > 0) out.push({ text: `Perfect x${o.perfect}`, color: INK.accent })
  if (o.dailyWinPack) out.push({ text: 'First win today: +1 pack', color: INK.good })
  if (o.bounty) out.push({ text: `${nameOf(o.bounty)} spun out of their corner!`, color: rarityColorOf(o.bounty) })
  return join(out)
}

/** The result's headline for its stage. */
export function outcomeHeadline(m: OutcomeMoment, stage: OutcomeStage): Line {
  const o = m.outcome
  const card = catchCard(m)
  const name = card ? nameOf(card) : '?'
  const color = card ? rarityColorOf(card) : undefined
  switch (stage) {
    case 'choose': return [{ text: `Won vs ${opponentLabel(o.opponent, o.lead)}! Pick one to keep`, bold: true }]
    case 'catching': return [{ text: 'Catching ' }, { text: name, color, bold: true }, { text: '…' }]
    case 'caught': return [{ text: 'Gotcha! ', color: INK.accent, bold: true }, { text: name, color, bold: true }, { text: ' joined your collection' }]
    case 'slipped': return isMythicCard(card)
      ? [{ text: 'It slipped away… ', bold: true }, { text: 'Nobody will ever see it again.', dim: true }]
      : [{ text: 'It slipped away!', bold: true }]
    case 'fled': return [{ text: 'It vanished into the static. ', color: MYTHIC_COLOR, bold: true }, { text: 'Nobody will ever see it again.' }]
    case 'none': return [{ text: outcomeSummary(o), bold: o.result === 'win' }]
  }
}

/** The second line under a headline: the summary, unless the headline already is it. */
export function outcomeDetail(m: OutcomeMoment, stage: OutcomeStage, offline: boolean): Line {
  const o = m.outcome
  const parts: Line = []
  if (stage !== 'none' && stage !== 'choose') parts.push({ text: outcomeSummary(o), dim: true })
  const card = catchCard(m)
  if (stage === 'caught' && card) {
    const mythic = isMythicCard(card)
    parts.push({ text: mythic ? (offline ? 'Local mythic' : 'Mythic · 1 of 1') : rarityWords(card), color: rarityColorOf(card) })
  }
  return join(parts)
}

/** How many seconds the rarest pick waits for a choice. */
export const choiceSeconds = (m: OutcomeMoment, now: number) => (m.outcome.catch.status === 'choose' ? Math.max(0, Math.ceil((m.outcome.catch.deadline - now) / 1000)) : 0)

/** The evolve moment's stage: evolving while its ceremony runs, then the result (SPEC 13.6). */
export function evolveStage(m: EvolveMoment, now: number, motion: boolean): 'evolving' | 'evolved' {
  if (!motion || m.until === null) return 'evolved'
  return now < m.until - EVOLVE_SHOW + TIMING.evolve ? 'evolving' : 'evolved'
}

/** What one evolution added: the stage's own share of each stat, at the card's level. */
export function evolveGains(card: Card, stage: number): Stats | null {
  if (stage < 2) return null
  try {
    const now = cardStats({ ...card, stage: stage as 1 | 2 | 3 })
    const before = cardStats({ ...card, stage: (stage - 1) as 1 | 2 | 3 })
    return { hp: now.hp - before.hp, atk: now.atk - before.atk, def: now.def - before.def, spd: now.spd - before.spd }
  } catch {
    return null
  }
}

export function gainsWords(g: Stats | null): string {
  if (!g) return ''
  const part = (label: string, n: number) => n > 0 && `${label} +${n}`
  return dots(part('HP', g.hp), part('Atk', g.atk), part('Def', g.def), part('Spd', g.spd))
}

/** The team's lead card, for moments about your own creatures. */
export function leadCard(state: Pick<BandState, 'me' | 'cards'>): Card | null {
  const id = state.me?.player.team[0]
  return (state.cards.find(c => c.id === id) ?? null) as Card | null
}

/** The family of the newest waiting pack, for the pack-ready package's colour. */
export function packFamily(state: Pick<BandState, 'me' | 'signals'>): Family {
  return state.me?.packs.at(-1)?.family ?? state.signals.family
}


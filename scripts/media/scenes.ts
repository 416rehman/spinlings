// A shot is one state of the game held for a while; a scene is that shot drawn in the Code tab: the band above the
// prompt, or the pane docked there, each from the mod's own view functions. A recording lays shots end to end.
import { INERT } from '../../plugin/hooks/client/demo.ts'
import { spinnerSuffix, statusLine } from '../../plugin/hooks/client/game.ts'
import type { GameState } from '../../plugin/hooks/client/types.ts'
import type { Scene } from './clock.ts'
import { compact, compose } from './clock.ts'
import { PAD, TOP, conversation, doc, frame, keycap, prompt, spinner } from './desk.ts'
import type { Theme } from './view.ts'
import { CELL, draw } from './view.ts'

const { band } = await import('../../plugin/hooks/ui/band.tsx')
const { pane } = await import('../../plugin/hooks/ui/pane.tsx')

/** The element table the views draw with: each element is its own name, read back by view.ts. */
export const el = new Proxy({}, { get: (_, k) => String(k) }) as never

/** The band's columns in these recordings: the wide band, both creatures beside the story. */
export const COLUMNS = 100
export const W = COLUMNS * CELL.w + PAD * 2
const INSET = 16
export const PANE_COLUMNS = Math.floor((W - PAD * 2 - INSET * 2) / CELL.w)

export type Shot = {
  state: GameState
  now: number
  ms: number
  /** a key pressed as the shot begins, shown as a cap */
  key?: string
  /** Claude is working (the spinner shows); true unless set */
  working?: boolean
  /** draw the pane docked above the prompt instead of the band */
  pane?: boolean
}

function chrome(s: Shot, t: Theme, h: number, topOf: number, inner: string): string {
  const promptY = h - 92
  const conv = conversation(PAD, 0, W - PAD * 2, t)
  let svg = `<g clip-path="url(#chat)"><g transform="translate(0 ${topOf - 16 - conv.h})">${conv.svg}</g></g>`
  svg += inner
  svg += prompt(PAD, promptY, W - PAD * 2, t, statusLine(s.state))
  if (s.key) svg += keycap(W - PAD - 96, promptY + 6, s.key, t)
  return compact(svg)
}

/** The band (the mod's tree) above the prompt, the spinner and the conversation above it. */
export function bandScene(s: Shot, t: Theme, h: number): string {
  const working = s.working ?? true
  const tree = band({ el, surface: 'desktop', columns: COLUMNS, rows: 4, now: s.now, actions: INERT, state: { ...s.state, clock: s.now }, isWorking: working } as never)
  const promptY = h - 92
  const drawn = tree ? draw(tree, PAD, 0, COLUMNS, t) : null
  const bandY = promptY - 14 - (drawn ? drawn.h : 0)
  const spinY = bandY - (drawn ? 14 : 4) - 20
  let inner = ''
  if (working) inner += spinner(PAD, spinY, t, 'Thinking…', spinnerSuffix(s.state.battle, '', 'responding', s.state.prefs.quiet) ?? '')
  if (drawn) inner += `<g transform="translate(0 ${bandY})">${drawn.svg}</g>`
  return chrome(s, t, h, working ? spinY : bandY, inner)
}

/** The pane docked above the prompt, at a fixed height like a real dock, its content from the top. */
export function paneScene(s: Shot, t: Theme, h: number, panelH: number): string {
  const state = { ...s.state, clock: s.now }
  const tree = pane({ el, surface: 'desktop', columns: PANE_COLUMNS, rows: 40, now: s.now, actions: INERT, state, focused: true, placement: 'dock' } as never)
  const promptY = h - 92
  const panelY = promptY - 14 - panelH
  const drawn = draw(tree, PAD + INSET, 0, PANE_COLUMNS, t)
  const inner = `<rect x="${PAD + 0.5}" y="${panelY + 0.5}" width="${W - PAD * 2 - 1}" height="${panelH - 1}" rx="12" fill="${t.surface}" stroke="${t.line}"/>`
    + `<g transform="translate(0 ${panelY + INSET})">${drawn.svg}</g>`
  return chrome(s, t, h, panelY, inner)
}

/** The tallest pane among the shots, so the dock keeps one height through a recording. */
function panelHeight(shots: Shot[], t: Theme): number {
  let max = 0
  for (const s of shots) {
    if (!s.pane) continue
    const tree = pane({ el, surface: 'desktop', columns: PANE_COLUMNS, rows: 40, now: s.now, actions: INERT, state: { ...s.state, clock: s.now }, focused: true, placement: 'dock' } as never)
    max = Math.max(max, draw(tree, 0, 0, PANE_COLUMNS, t).h)
  }
  return max + INSET * 2
}

/** Lays shots end to end on one clock and wraps them in the window. */
export function recording(shots: Shot[], t: Theme, h: number, title: string): string {
  const panelH = panelHeight(shots, t)
  let at = 0
  const scenes: Scene[] = shots.map(s => {
    const sc = { at, ms: s.ms, svg: s.pane ? paneScene(s, t, h, panelH) : bandScene(s, t, h) }
    at += s.ms
    return sc
  })
  const clip = `<defs><clipPath id="chat"><rect x="0" y="${TOP + 1}" width="${W}" height="${h - TOP - 120}"/></clipPath></defs>`
  return doc(W, h, t, clip + frame(W, h, t) + compose(scenes, at), title)
}

/** Shots taken one after another from `start`: `shoot(state, ms)` holds a state for ms. */
export function camera(start: number, base: Partial<Shot> = {}) {
  const shots: Shot[] = []
  let clock = start
  return {
    shots,
    now: () => clock,
    shoot(state: GameState, ms: number, o: Partial<Shot> = {}) {
      shots.push({ ...base, ...o, state, now: clock, ms })
      clock += ms
    },
  }
}

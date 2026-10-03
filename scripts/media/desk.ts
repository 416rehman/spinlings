// The desktop app's Code tab around the mod, drawn plainly: a window, the conversation as soft placeholder bars (the
// game never sees the work, so neither does the picture), the spinner, the band above the prompt, the prompt and the
// status line. Only the frame is drawn here; everything inside the band and the pane is the mod's own output.
import type { Theme } from './view.ts'
import { CELL, MONO } from './view.ts'

export const PAD = 32
export const TOP = 40

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function doc(w: number, h: number, t: Theme, body: string, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
    + `<title>${esc(title)}</title>` + body + '</svg>'
}

/** The window: its edge, the title bar with the Code tab, and the page colour. */
export function frame(w: number, h: number, t: Theme): string {
  return `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${t.bg}" stroke="${t.line}"/>`
    + `<path d="M1 ${TOP}H${w - 1}" stroke="${t.line}"/>`
    + `<g transform="translate(18 ${TOP / 2})">`
    + [0, 1, 2].map(i => `<circle cx="${i * 16}" cy="0" r="5" fill="${t.faint}"/>`).join('')
    + `</g>`
    + `<rect x="${w / 2 - 34}" y="9" width="68" height="22" rx="7" fill="${t.raised}"/>`
    + `<text x="${w / 2}" y="24" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${t.text}">Code</text>`
}

/** Placeholder bars for the conversation: requests on the right, answers on the left, steps folded away. */
export function conversation(x: number, y: number, w: number, t: Theme, o: { exchanges?: number } = {}): { svg: string; h: number } {
  const bar = (bx: number, by: number, bw: number, op = 1) => `<rect x="${bx}" y="${by}" width="${bw}" height="8" rx="4" fill="${t.faint}" fill-opacity="${op}"/>`
  let svg = ''
  let cy = y
  const n = o.exchanges ?? 2
  for (let k = 0; k < n; k++) {
    const rw = Math.round(w * (k === n - 1 ? 0.46 : 0.34))
    svg += `<rect x="${x + w - rw}" y="${cy}" width="${rw}" height="44" rx="12" fill="${t.raised}"/>`
    svg += bar(x + w - rw + 16, cy + 12, rw - 48) + bar(x + w - rw + 16, cy + 26, Math.round(rw * 0.45))
    cy += 64
    for (const f of k === n - 1 ? [0.92, 0.84, 0.6] : [0.88, 0.7]) { svg += bar(x, cy, Math.round(w * f), 0.8); cy += 18 }
    cy += 8
    for (let i = 0; i < 2; i++) {
      svg += `<rect x="${x + 0.5}" y="${cy + 0.5}" width="${Math.round(w * 0.5)}" height="26" rx="7" fill="none" stroke="${t.line}"/>`
        + `<circle cx="${x + 14}" cy="${cy + 13}" r="3" fill="${t.dim}" fill-opacity="0.6"/>` + bar(x + 26, cy + 9, Math.round(w * 0.3), 0.7)
      cy += 34
    }
    if (k < n - 1) cy += 20
  }
  return { svg, h: cy - y }
}

/** The spinner row: a turning star, the spinner's word and, during a battle, the mod's suffix. */
export function spinner(x: number, y: number, t: Theme, word: string, suffix: string): string {
  const star = `<g transform="translate(${x + 6} ${y + 10})"><path d="M0 -6L1.6 -1.6L6 0L1.6 1.6L0 6L-1.6 1.6L-6 0L-1.6 -1.6Z" fill="#d6a85c">`
    + `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.4s" repeatCount="indefinite"/></path></g>`
  return star + `<text x="${x + 20}" y="${y + 14}" font-family="${MONO}" font-size="${CELL.font}" xml:space="preserve"><tspan fill="#d6a85c">${esc(word)}</tspan><tspan fill="${t.dim}">${esc(suffix)}</tspan></text>`
}

/** The prompt box, empty and waiting, and the status line under it. */
export function prompt(x: number, y: number, w: number, t: Theme, status: string | undefined): string {
  const caret = `<rect x="${x + 18}" y="${y + 16}" width="1.5" height="18" fill="${t.text}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" repeatCount="indefinite"/></rect>`
  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="50" rx="14" fill="${t.surface}" stroke="${t.line}"/>`
    + caret
    + `<text x="${x + 26}" y="${y + 30}" font-family="${MONO}" font-size="${CELL.font}" fill="${t.dim}" fill-opacity="0.7">Reply to Claude</text>`
    + `<rect x="${x + w - 40}" y="${y + 11}" width="28" height="28" rx="9" fill="${t.raised}"/>`
    + `<path d="M${x + w - 26} ${y + 32}V${y + 19}M${x + w - 31} ${y + 24}L${x + w - 26} ${y + 19}L${x + w - 21} ${y + 24}" stroke="${t.dim}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    + (status ? `<text x="${x + 4}" y="${y + 72}" font-family="${MONO}" font-size="12" fill="${t.dim}" xml:space="preserve">${esc(status)}</text>` : '')
}

/** A pressed key, the way screen recordings show one: a cap that pops in the corner, then fades. */
export function keycap(x: number, y: number, key: string, t: Theme): string {
  return `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.7;1" dur="0.9s" fill="freeze"/>`
    + `<rect x="${x}" y="${y}" width="38" height="38" rx="9" fill="${t.surface}" stroke="#f2b33d" stroke-width="2"/>`
    + `<rect x="${x + 4}" y="${y + 4}" width="30" height="27" rx="6" fill="${t.raised}"/>`
    + `<text x="${x + 19}" y="${y + 24}" text-anchor="middle" font-family="${MONO}" font-size="15" font-weight="700" fill="${t.text}">${esc(key)}</text></g>`
}

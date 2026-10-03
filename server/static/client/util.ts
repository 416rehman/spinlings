// Small shared pieces: DOM helpers, the motion primitives (site brief 2.5), the live region, local
// state and sprite markup. The pixel world moves in steps on whole art pixels; UI glides.
import { spriteFor } from '../../../plugin/hooks/core/sprite.ts'
import type { SpriteSource } from '../../../plugin/hooks/core/sprite.ts'
import { boldWordSvg, wordSvg } from '../../src/pages-font.ts'
import { spriteSvg } from '../../src/pages-sprite.ts'

export const D = document
export const H = D.documentElement

export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = D): T | null => r.querySelector(s) as T | null
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = D): T[] => [...r.querySelectorAll(s)] as T[]

const rmq = matchMedia('(prefers-reduced-motion: reduce)')
/** Reduced motion: the OS setting, or the dev preview. */
export const RM = () => rmq.matches || H.dataset.motion === 'reduce'
export const touch = () => matchMedia('(hover: none), (pointer: coarse)').matches

/** One art pixel in CSS px (4 at 1024 and wider, 3 below). */
export const ap = () => parseFloat(getComputedStyle(H).getPropertyValue('--ap')) || 3

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** Waits, then waits again while the tab is hidden (ceremonies and battles pause with the tab). */
export async function wait(ms: number) {
  await sleep(ms)
  while (D.hidden) await new Promise(r => D.addEventListener('visibilitychange', r, { once: true }))
}

/** Parses trusted, text-free markup (sprites and pixel words) into an element. */
export function frag<T extends Element = Element>(markup: string): T {
  const t = D.createElement('template')
  t.innerHTML = markup
  return t.content.firstElementChild as T
}

/** An element with optional class and text (always textContent). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = D.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** A creature as a layered SVG element. */
export const sprite = (src: SpriteSource, cls = '') => frag<SVGSVGElement>(spriteSvg(spriteFor(src), { cls }))
/** A word in the pixel font. */
export const pword = (w: string, cls = 'pw') => frag<SVGSVGElement>(wordSvg(w, cls))
/** Pixel words for a line, as a .pt span (the bold cut for headline moments). */
export function pline(text: string, cls = 'pt', bold = false): HTMLSpanElement {
  const s = el('span', cls)
  s.setAttribute('aria-hidden', 'true')
  text.split(' ').filter(Boolean).forEach((w, i) => { if (i) s.append(' '); s.append(bold ? frag<SVGSVGElement>(boldWordSvg(w, 'pw bd', true)) : pword(w)) })
  return s
}

/**
 * The stepped animation every pixel-world motion uses: one transform per frame, held for `ms`.
 * Resolves when done; does nothing under reduced motion.
 */
export function steps(node: Element | null | undefined, frames: string[], ms: number, o: { opacity?: number[] } = {}): Promise<void> {
  if (!node || RM() || !frames.length) return Promise.resolve()
  const kf: Keyframe[] = frames.map((t, i) => ({ transform: t, offset: i / frames.length, easing: 'steps(1, end)', ...(o.opacity ? { opacity: o.opacity[i] } : {}) }))
  kf.push({ transform: frames[frames.length - 1]!, offset: 1, ...(o.opacity ? { opacity: o.opacity[frames.length - 1] } : {}) })
  return settle(node.animate(kf, { duration: ms * frames.length }), ms * frames.length)
}

/** An animation's end, or its planned end by the clock (whichever comes first), finished either way. */
export function settle(a: Animation, ms: number): Promise<void> {
  return new Promise(res => {
    const t = setTimeout(() => { try { a.finish() } catch { a.cancel() } res() }, ms + 40)
    a.finished.then(() => { clearTimeout(t); res() }, () => { clearTimeout(t); res() })
  })
}

const ty = (n: number) => `translateY(${n}px)`
const tx = (n: number) => `translateX(${n}px)`
/** hop: y 0, -2, -3, -1, 0 art px, 100 ms each */
export const hop = (n: Element | null | undefined) => { const a = ap(); return steps(n, [ty(0), ty(-2 * a), ty(-3 * a), ty(-a), ty(0)], 100) }
/** a wobble beat: x +1, 0, -1, 0 art px at 150 ms */
export const wobble = (n: Element | null | undefined, beats = 1) => {
  const a = ap(), f: string[] = []
  for (let i = 0; i < beats; i++) f.push(tx(a), tx(0), tx(-a), tx(0))
  return steps(n, f, 150)
}
/** shake: the scene at +-1 art px for 2 frames */
export const shake = (n: Element | null | undefined) => { const a = ap(); return steps(n, [tx(a), tx(-a), tx(0)], 50) }

/** The one-frame flash: the white silhouette swapped in for 80 ms (an outline stands in under reduced motion). */
export async function flash(svg: Element | null | undefined) {
  if (!svg) return
  if (RM()) { (svg as HTMLElement).style.outline = '2px solid #fffdf5'; await sleep(80); (svg as HTMLElement).style.outline = ''; return }
  svg.classList.add('flash')
  await sleep(80)
  svg.classList.remove('flash')
}

/** A pip (! or ?) 2 art px above a creature's head for 600 ms. */
export async function pip(host: Element | null | undefined, ch: '!' | '?' | 'z', ms = 600) {
  if (!host) return
  const p = el('span', 'pip')
  p.setAttribute('aria-hidden', 'true')
  p.append(pword(ch))
  host.append(p)
  await sleep(ms)
  p.remove()
}

/** The polite live region: only ceremony lines, specials, Perfects, knock-outs and results. */
export function say(text: string) {
  const live = $('#live') ?? (() => { const l = el('p', 'sr'); l.id = 'live'; l.setAttribute('aria-live', 'polite'); D.body.append(l); return l })()
  live.textContent = ''
  setTimeout(() => { live.textContent = text }, 30)
}

// ---- local state: the visitor's creature, kept 30 days, never sent anywhere -----------------------

/** `entry` is what the seed met (pages-meet entryKey); `t` is when this was last written. */
export type Saved = { seed: string; entry: string; level: number; xp: number; shortcuts?: boolean; t: number }
const KEY = 'spinlings.site.v1'
export const store = {
  get(): Partial<Saved> | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
      return v && typeof v === 'object' ? v : null
    } catch { return null }
  },
  set(patch: Partial<Saved>) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...(store.get() ?? {}), ...patch, t: Date.now() })) } catch { /* private mode: the page simply never remembers */ }
  },
}

/** Clipboard write; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

/** Selects an element's text so the visitor can copy it themselves. */
export function selectText(node: Node) {
  const r = D.createRange()
  r.selectNodeContents(node)
  const s = getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

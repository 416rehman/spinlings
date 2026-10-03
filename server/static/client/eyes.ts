// Every creature on the page watches the pointer and blinks (site brief 10, items 3 and 4). Up to 12
// visible creatures shift their eye layer one sprite pixel toward the pointer, only by the offsets
// their sprite allows (data-eo), in one rAF that runs only when the pointer moves. Blinks swap the
// eye layer for lids at a random 3 to 7 s; after 6 s of stillness a wave of blinks runs down the line.
import { $$, D, RM, sleep } from './util.ts'

type Eyes = { svg: SVGSVGElement; g: SVGGElement | null; eo: string; target?: { x: number; y: number } | Element; next: number }

const all = new Map<SVGSVGElement, Eyes>()
const visible = new Set<SVGSVGElement>()
let px = -1, py = -1, queued = false, lastMove = 0, touchUntil = 0

const io = new IntersectionObserver(entries => {
  for (const e of entries) e.isIntersecting ? visible.add(e.target as SVGSVGElement) : visible.delete(e.target as SVGSVGElement)
}, { rootMargin: '64px' })

/** Starts watching every layered sprite under `root`. */
export function scan(root: ParentNode = D) {
  for (const svg of $$<SVGSVGElement>('svg.spr[data-eo]', root)) {
    if (all.has(svg)) continue
    all.set(svg, { svg, g: svg.querySelector('g.e'), eo: svg.dataset.eo ?? '', next: performance.now() + 3000 + Math.random() * 4000 })
    io.observe(svg)
  }
  // forget the ones that left the page
  for (const svg of all.keys()) if (!svg.isConnected) { all.delete(svg); visible.delete(svg); io.unobserve(svg) }
  queue()
}

/** Points a creature's eyes at an element or a point until `ms` passes (or for good with no ms). */
export function lookAt(svg: SVGSVGElement | null | undefined, target: Element | { x: number; y: number } | undefined, ms?: number) {
  const e = svg && all.get(svg)
  if (!e) return
  e.target = target
  queue()
  if (ms) setTimeout(() => { if (e.target === target) { e.target = undefined; queue() } }, ms)
}

function queue() {
  if (queued) return
  queued = true
  requestAnimationFrame(update)
}

function update() {
  queued = false
  const list = [...visible].slice(0, 12)
  for (const svg of list) {
    const e = all.get(svg)
    if (!e?.g) continue
    let tx = px, tyy = py
    if (e.target) {
      if (e.target instanceof Element) { const r = e.target.getBoundingClientRect(); tx = r.left + r.width / 2; tyy = r.top + r.height / 2 } else { tx = e.target.x; tyy = e.target.y }
    } else if (px < 0 || (touchUntil && performance.now() > touchUntil)) {
      e.g.style.transform = ''
      continue
    }
    const r = svg.getBoundingClientRect()
    const dx = tx - (r.left + r.width / 2), dy = tyy - (r.top + r.height * 0.4)
    const flip = getComputedStyle(svg).transform.startsWith('matrix(-1') ? -1 : 1
    let ox = Math.abs(dx) > 24 ? Math.sign(dx) * flip : 0
    let oy = Math.abs(dy) > 48 ? Math.sign(dy) : 0
    if ((ox < 0 && !e.eo.includes('l')) || (ox > 0 && !e.eo.includes('r'))) ox = 0
    if ((oy < 0 && !e.eo.includes('u')) || (oy > 0 && !e.eo.includes('d'))) oy = 0
    e.g.style.transform = ox || oy ? `translate(${ox}px,${oy}px)` : ''
  }
}

/** A blink: lids for 120 ms. */
export async function blink(svg: SVGSVGElement) {
  if (RM() || svg.classList.contains('shut')) return
  svg.classList.add('blink')
  await sleep(120)
  svg.classList.remove('blink')
}

let waved = false
function blinkLoop() {
  const now = performance.now()
  if (!D.hidden && !RM()) {
    for (const svg of visible) {
      const e = all.get(svg)
      if (e && now >= e.next) { void blink(svg); e.next = now + 3000 + Math.random() * 4000 }
    }
    // after 6 s of pointer stillness, one staggered wave of blinks
    if (!waved && lastMove && now - lastMove > 6000) {
      waved = true
      ;[...visible].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).forEach((svg, i) => setTimeout(() => void blink(svg), i * 90))
    }
  }
  setTimeout(blinkLoop, 400)
}

export function start() {
  D.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return
    px = e.clientX; py = e.clientY; lastMove = performance.now(); waved = false; touchUntil = 0
    queue()
  }, { passive: true })
  // touch: look at the last tap for 2 s, then back to centre
  D.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return
    px = e.clientX; py = e.clientY; touchUntil = performance.now() + 2000
    queue()
    setTimeout(queue, 2050)
  }, { passive: true })
  addEventListener('scroll', queue, { passive: true })
  scan()
  blinkLoop()
}

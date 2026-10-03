// The hero (#meet): the first five seconds (site brief 4.3), the meet ceremony (4.4), return visits
// (4.5) and the meadow's small toys: teammates' family moves, grass that leans from the pointer,
// lamps, the draggable sun, sleepy creatures at night, fireflies, falling letters and the `spin` egg.
import { cardName } from '../../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../../plugin/hooks/core/families.ts'
import { miniSprite, spriteFor } from '../../../plugin/hooks/core/sprite.ts'
import type { Family } from '../../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, RARITY_COLOR } from '../../../plugin/hooks/ui/tokens.ts'
import { HOUR_FAMILY, HOURS, hourAt } from '../../src/pages-meet.ts'
import type { Hour, SiteCard } from '../../src/pages-meet.ts'
import { catchCard, spoken } from './card.ts'
import { lookAt, scan } from './eyes.ts'
import * as keys from './keys.ts'
import { $, $$, ap, D, el, flash, H, hop, pip, RM, say, shake, sleep, sprite, steps, touch, wait, wobble } from './util.ts'
import { changed, hooks, hour, keep, onTeam, restore, roll, T, W } from './world.ts'

const hero = $('#meet')!
const chip = $('[data-chip]') as HTMLElement
const patch = $('[data-patch]')!
const hide = $('[data-hide]')!
const actors = $('.actors')!
const scene = $('[data-scene]')!

let gen = 0
let drawnStage = 0
let phase: 'rustle' | 'waiting' | 'meeting' | 'met' = 'rustle'
let you: HTMLButtonElement | null = null
const youSvg = () => you?.querySelector<SVGSVGElement>('svg.spr') ?? null
const matesShown = () => $$<HTMLButtonElement>('.mate').filter(m => m.offsetParent !== null)

const SHADE = '#1d1726'
const rustleFor = (c: SiteCard) => ({ common: 1800, rare: 2100, epic: 2400, legendary: 2400 })[c.rarity] + (c.shiny ? 600 : 0)

/** The bubble's line. One inline run, so the spaces around a name survive the bubble's flex box. */
function setChip(...parts: (string | Node)[]) {
  chip.replaceChildren(el('span', 'line'))
  chipLine().append(...parts)
  aimTail()
}

/** The bubble's tail points at whoever is talking: the bush while it rustles, then the creature. */
function aimTail() {
  const t = you ?? $('.tuftbox')
  const b = chip.getBoundingClientRect(), r = t?.getBoundingClientRect()
  if (!r || !b.width) return
  const a = ap()
  chip.style.setProperty('--tail-x', `${Math.round(Math.max(12, Math.min(b.width - 3 * a - 12, r.left + r.width / 2 - b.left - 1.5 * a)) / a) * a}px`)
}

/** A few leaf pixels kicked up from (x, y) inside `host`, rising and fading in 4 frames. */
function kick(host: HTMLElement, x: number, y: number, n = 3, color = 'var(--g1)') {
  if (RM()) return
  const a = ap()
  for (let i = 0; i < n; i++) {
    const s = el('i', 'burst')
    s.style.background = color
    s.style.left = `${x + (i - (n - 1) / 2) * 2 * a}px`
    s.style.top = `${y}px`
    host.append(s)
    const up = (4 + ((i * 7) % 3)) * a, dx = (i - (n - 1) / 2) * a
    void steps(s, [`translate(${dx / 2}px,${-up / 2}px)`, `translate(${dx}px,${-up}px)`, `translate(${dx}px,${-up}px)`, `translate(${dx}px,${-up + a}px)`], 100, { opacity: [1, 1, 0.6, 0.2] }).then(() => s.remove())
  }
}
const chipLine = () => (chip.firstElementChild as HTMLElement | null) ?? chip
const nameNode = (c: SiteCard) => { const b = el('b', '', cardName(c)); b.style.color = RARITY_COLOR[c.rarity]; return b }

// ---- favicon: a face with a white ! while a wild one waits, the visitor's creature after ----------

export function favicon(c: SiteCard | null, bang: boolean) {
  const link = $<HTMLLinkElement>('link[rel=icon]')
  if (!link || !c) return
  const px = miniSprite(spriteFor(c))
  if (bang) { px[0]![7] = 0xfffdf5; px[1]![7] = 0xfffdf5; px[3]![7] = 0xfffdf5 }
  let d = ''
  px.forEach((r, y) => r.forEach((v, x) => { if (v >= 0) d += `<path fill="#${v.toString(16).padStart(6, '0')}" d="M${x} ${y}h1v1h-1z"/>` }))
  link.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${d}</svg>`)
}

// ---- the creature's places ------------------------------------------------------------------------

/**
 * The creature's button, showing `c`. A meet keeps the very button the visitor pressed (only its
 * sprite and label change), so keyboard focus stays on the creature they just met.
 */
function makeYou(c: SiteCard): HTMLButtonElement {
  if (!you) {
    const b = el('button', 'you')
    b.type = 'button'
    b.addEventListener('click', () => { if (phase === 'waiting') void meetNow(); else poke() })
    b.addEventListener('pointerenter', () => { if (phase === 'met' || phase === 'waiting') void hop(youSvg()) })
    b.addEventListener('focus', () => { if (phase === 'met') void hop(youSvg()) })
    // first among the actors, so it is the meadow's first Tab stop
    actors.prepend(b)
    you = b
  }
  you.setAttribute('aria-label', `Meet ${cardName(c)}`)
  you.setAttribute('aria-keyshortcuts', '1')
  you.replaceChildren(sprite(c))
  scan(you)
  return you
}

/** Puts the met creature at the front of the team. */
function placeMet() {
  const c = T.lead!
  drawnStage = c.stage
  makeYou(c)
  you!.setAttribute('aria-label', `${cardName(c)}, ${FAMILY_INFO[c.family].name} teammate`)
  you!.removeAttribute('aria-keyshortcuts')
  hide.replaceChildren()
  phase = 'met'
  favicon(c, false)
}

/**
 * While no creature stands in the meadow (one walked off, the next still rustling), keyboard focus
 * that was on it, or on the bubble's button, waits on the headline instead of dropping to the page;
 * the next creature takes it back once it is out (wake).
 */
const headline = () => $('#meet-h')
function holdFocus(from: Element | null) {
  const a = D.activeElement
  if (a && from?.contains(a)) headline()?.focus({ preventScroll: true })
}
function wake() {
  if (you && D.activeElement === headline()) you.focus({ preventScroll: true })
}

// ---- the rustle, the reveal and the hint -----------------------------------------------------------

async function rustle() {
  const g = ++gen
  phase = 'rustle'
  const c = roll()
  changed()
  favicon(c, true)
  you?.remove()
  you = null
  const shade = `color-mix(in srgb,${FAMILY_COLOR[c.family]} 48%,${SHADE})`
  const svg = sprite(c, 'sil')
  svg.style.setProperty('--silc', shade)
  hide.replaceChildren(svg)
  // only the top 3 art px peek over the tuft
  const a = ap(), size = hide.getBoundingClientRect().height || 64
  const top = spriteFor(c).findIndex(r => r.some(v => v >= 0))
  const lift = Math.round(size - (top * size) / 16 - 13 * a)
  svg.style.transform = `translateY(${Math.max(0, lift)}px)`
  if (RM()) return revealNow(c)
  await wait(600)
  if (g !== gen) return
  setChip('Something is rustling…')
  say('Something is rustling…')
  for (const m of matesShown()) lookAt(m.querySelector('svg.spr') as SVGSVGElement, patch, rustleFor(c) + 900)
  const tip = $('.tuftbox .tt')
  const end = performance.now() + rustleFor(c)
  let k = 0
  const extras = c.rarity === 'rare' || c.rarity === 'epic' || c.shiny
  let star: HTMLElement | null = null
  if (c.shiny) { star = el('i', 'burst'); star.style.cssText = 'width:calc(3*var(--ap));height:calc(3*var(--ap));clip-path:polygon(33% 0,67% 0,67% 33%,100% 33%,100% 67%,67% 67%,67% 100%,33% 100%,33% 67%,0 67%,0 33%,33% 33%)'; hide.append(star) }
  const pr = patch.getBoundingClientRect()
  while (performance.now() < end) {
    if (g !== gen) return
    // the tuft shakes in 2 frames at 8 fps; the silhouette wobbles a beat every 600 ms and kicks up leaves
    tip?.setAttribute('transform', k % 2 ? 'translate(2 0)' : 'translate(-2 0)')
    if (k % 5 === 0) { void wobble(svg); kick(patch, pr.width * (0.3 + ((k * 13) % 5) / 10), 0, 2 + (k % 2)) }
    if (extras && c.rarity === 'rare' && !c.shiny) svg.style.setProperty('--silc', k % 5 < 2 ? shade : `color-mix(in srgb,${FAMILY_COLOR[c.family]} 40%,#fffdf5)`)
    if (c.rarity === 'epic') svg.style.setProperty('--silc', k % 2 ? '#b06ef3' : shade)
    if (star) { const t = (k % 8) / 7; star.style.left = `${Math.round(t * 100)}%`; star.style.top = `${30 + Math.round(t * 20)}%` }
    k++
    await sleep(125)
  }
  star?.remove()
  tip?.removeAttribute('transform')
  // stillness, then the flash, then colour
  await wait(300)
  if (g !== gen) return
  await flash(svg)
  if (g !== gen) return
  await reveal(c, g)
}

function revealNow(c: SiteCard) {
  hide.replaceChildren()
  makeYou(c)
  phase = 'waiting'
  say(`A wild ${cardName(c)} appeared!`)
  hint(c)
  wake()
}

async function reveal(c: SiteCard, g: number) {
  hide.replaceChildren()
  const b = makeYou(c)
  const svg = youSvg()!
  // hop out of the tuft and land on the path in front of it, in 4 frames
  const from = patch.getBoundingClientRect(), to = b.getBoundingClientRect()
  const dx = Math.round(from.left + from.width / 2 - (to.left + to.width / 2)), a = ap()
  await steps(svg, [`translate(${dx}px,${3 * a}px)`, `translate(${Math.round(dx * 0.66)}px,${-5 * a}px)`, `translate(${Math.round(dx * 0.33)}px,${-6 * a}px)`, `translate(0px,${-2 * a}px)`, 'translate(0,0)'], 100)
  kick(patch, from.width / 2, 0, 4)
  setChip('A wild ', nameNode(c), ' appeared!')
  say(`A wild ${cardName(c)} appeared!`)
  phase = 'waiting'
  wake()
  matesShown().forEach((m, i) => setTimeout(() => { void pip(m, '!'); void hop(m.querySelector('svg.spr')) }, i * 100))
  await wait(900)
  if (g !== gen) return
  if (c.foil) void steps(svg, ['translateX(0)'], 400)
  if (c.foil) { b.classList.add('sheen'); setTimeout(() => b.classList.remove('sheen'), 400) }
  if (c.shiny) chipLine().append(' Shiny! Only one wild creature in 100 looks like this.')
  await wait(c.shiny ? 1400 : 400)
  if (g !== gen) return
  hint(c)
}

function hint(c: SiteCard) {
  setChip(touch() ? `Tap ${cardName(c)} to meet it.` : `Press 1 or click ${cardName(c)} to meet it.`)
  // left alone, it hops at 10 s and glances at the team, then back at you; it never meets you by itself
  const g = gen
  setTimeout(async () => {
    if (g !== gen || phase !== 'waiting') return
    await hop(youSvg())
    const m = matesShown()[0]
    lookAt(youSvg(), m, 900)
  }, 10_000)
}

// ---- the meet ceremony -----------------------------------------------------------------------------

async function meetNow() {
  if (phase !== 'waiting' || !you || !T.lead) return
  phase = 'meeting'
  const g = ++gen
  const c = T.lead
  const svg = youSvg()!
  // the creature spins into a card back where it stands
  await steps(svg, ['scaleX(1)', 'scaleX(.6)', 'scaleX(.25)'], 75)
  svg.style.visibility = 'hidden'
  // the bubble keeps quiet while the card is up: the card says Gotcha! itself
  chip.replaceChildren()
  say(`Gotcha! ${spoken(c)}. It joined your team.`)
  await catchCard(c, you, { to: () => $('.slot[data-slot="0"]'), alive: () => g === gen })
  if (g !== gen) return
  svg.style.visibility = ''
  finishMeet(c)
  setChip(nameNode(c), ' joined your team.')
  // it hops back onto the path beside the team, and everyone cheers
  if (you) void steps(youSvg(), ['translateY(-12px) scale(.6)', 'translateY(-16px)', 'translateY(-8px)', 'translateY(0)'], 90)
  matesShown().forEach((m, i) => setTimeout(() => { void pip(m, '!', 500); void hop(m.querySelector('svg.spr')) }, 150 + i * 100))
  setTimeout(() => {
    if (phase !== 'met') return
    const a = el('a', '', `Take ${cardName(c)} into battle below.`)
    a.href = '#battle'
    setChip(a)
  }, 2500)
}

function finishMeet(c: SiteCard) {
  keep()
  placeMet()
  void c
  const slot = $('.slot[data-slot="0"]')
  slot?.classList.add('flash')
  setTimeout(() => slot?.classList.remove('flash'), 120)
}

/** "Meet a new one": the creature hops, walks off to the right, and a new rustle plays. */
export async function meetNew() {
  const svg = youSvg()
  holdFocus(you)
  phase = 'rustle'
  if (svg && !RM()) {
    await hop(svg)
    const a = ap()
    await steps(svg, [1, 2, 3, 4].map(k => `translateX(${k * 10 * a}px)`), 100, { opacity: [1, 1, 0.6, 0] })
  }
  you?.remove()
  you = null
  T.met = false
  changed()
  void rustle()
}

// ---- pokes, family moves, toys ----------------------------------------------------------------------

let pokes: number[] = []
function poke() {
  const svg = youSvg()
  if (!svg) return
  void hop(svg)
  const now = performance.now()
  pokes = pokes.filter(t => now - t < 2000).concat(now)
  if (pokes.length >= 5 && !RM()) {
    // it turns its back for 2 s, then hops back
    pokes = []
    svg.style.transform = 'scaleX(-1)'
    svg.classList.add('away')
    setTimeout(() => { svg.style.transform = ''; svg.classList.remove('away'); void hop(svg) }, 2000)
  }
}

const tagTimers = new WeakMap<Element, number>()
async function familyMove(m: HTMLButtonElement) {
  const f = m.dataset.fam as Family
  const svg = m.querySelector<SVGSVGElement>('svg.spr')!
  const tag = m.querySelector('.tag')!
  tag.textContent = `${m.getAttribute('aria-label')!.split(',')[0]}, ${FAMILY_INFO[f].name}`
  m.classList.add('named')
  clearTimeout(tagTimers.get(m))
  tagTimers.set(m, window.setTimeout(() => m.classList.remove('named'), 1500))
  if (RM()) return
  const a = ap()
  if (f === 'haiku') await steps(svg, ['scaleX(-1)', 'scaleX(1)', 'scaleX(-1)', 'scaleX(1)'], 80)
  else if (f === 'opus') { await hop(svg); void shake(scene) }
  else if (f === 'fable') {
    svg.style.visibility = 'hidden'
    await sleep(80)
    svg.style.transform = `translateX(${8 * a}px)`
    svg.style.visibility = ''
    await sleep(300)
    svg.style.visibility = 'hidden'
    await sleep(80)
    svg.style.transform = ''
    svg.style.visibility = ''
  } else {
    const w = el('span', 'wave')
    w.setAttribute('aria-hidden', 'true')
    w.innerHTML = '<svg viewBox="0 0 5 3" shape-rendering="crispEdges" fill="#dbe6fa"><path d="M0 1h1v1h-1zM1 0h1v1h-1zM2 1h1v1h-1zM3 2h1v1h-1zM4 1h1v1h-1z"/></svg>'
    Object.assign(w.style, { position: 'absolute', left: '50%', bottom: '100%', width: `${5 * a}px`, height: `${3 * a}px` })
    m.append(w)
    await steps(w, [0, 1, 2, 3, 4, 5, 6].map(k => `translate(-50%,${-k * a}px)`), 86, { opacity: [1, 1, 1, 1, .8, .5, 0] })
    w.remove()
  }
}

/** Grass leans away from the pointer; a tap flicks seeds up. */
function grass() {
  const tufts = $$<SVGGElement>('.lay.grass .tf')
  const rustleTip = $('.tuftbox')
  let raf = 0, lx = 0, ly = 0
  const lean = () => {
    raf = 0
    const r = scene.getBoundingClientRect(), a = ap()
    const grassTop = r.bottom - 16 * a
    if (ly < grassTop - 48 || ly > r.bottom + 40) return
    const cx = r.left + r.width / 2
    for (const t of tufts) {
      const sx = cx + (Number(t.dataset.x) - 256) * a
      if (Math.abs(sx - lx) < 40) {
        const cls = sx < lx ? 'lean-l' : 'lean-r'
        if (t.classList.contains(cls)) continue
        t.classList.add(cls)
        setTimeout(() => t.classList.remove(cls), 160)
      }
    }
    const pr = rustleTip?.getBoundingClientRect()
    if (pr && phase !== 'rustle' && Math.abs(pr.left + pr.width / 2 - lx) < 60 && Math.abs(pr.top - ly) < 60) {
      const tip = $('.tuftbox .tt')
      tip?.setAttribute('transform', `translate(${pr.left + pr.width / 2 < lx ? -1 : 1} 0)`)
      setTimeout(() => tip?.removeAttribute('transform'), 160)
    }
  }
  scene.addEventListener('pointermove', e => { lx = e.clientX; ly = e.clientY; if (!raf) raf = requestAnimationFrame(lean) })
  scene.addEventListener('pointerdown', e => {
    if ((e.target as Element).closest('button')) return
    const r = scene.getBoundingClientRect(), a = ap()
    if (e.clientY < r.bottom - 22 * a) return
    kick(scene, e.clientX - r.left, e.clientY - r.top)
  })
}

/** Lamps: off and on; the moths scatter and the nearest creature dozes, then wakes with a hop. */
function lamps() {
  for (const l of $$<HTMLButtonElement>('.lamp')) {
    // a toy for the pointer, out of the Tab order: the meadow's keyboard path is the creatures
    l.tabIndex = -1
    l.addEventListener('click', () => {
      const off = l.classList.toggle('off')
      l.setAttribute('aria-label', off ? 'Turn the lamp on' : 'Turn the lamp off')
      const near = [...matesShown(), ...(you ? [you] : [])].sort((x, y) => Math.abs(x.getBoundingClientRect().left - l.getBoundingClientRect().left) - Math.abs(y.getBoundingClientRect().left - l.getBoundingClientRect().left))[0]
      const svg = near?.querySelector('svg.spr')
      if (off) {
        svg?.classList.add('shut')
        if (!RM()) for (let i = 0; i < 3; i++) {
          const m = el('i', 'moth')
          l.append(m)
          const a = ap(), dx = (i - 1) * 6 * a
          void steps(m, [1, 2, 3, 4].map(k => `translate(${(dx * k) / 4}px,${-k * 3 * a}px)`), 90, { opacity: [1, 1, 0.6, 0] }).then(() => m.remove())
        }
      } else {
        svg?.classList.remove('shut')
        void hop(svg)
      }
    })
  }
}

/** The sun (or moon) on its arc: drag it to change the hour; it springs back to now on release. */
function sun() {
  const btn = $<HTMLButtonElement>('.sunbtn:not(.still)')
  if (!btn) return
  const now = () => hourAt(new Date().getHours())
  const name = (h: Hour) => `${FAMILY_INFO[HOUR_FAMILY[h]].name} ${h}. Drag me.`
  const paint = () => {
    btn.title = name(hour())
    btn.setAttribute('aria-label', `Change the time of day. Now: ${hour()}.`)
  }
  const set = (h: Hour) => { if (hour() !== h) { H.dataset.hour = h; paint(); changed() } }
  paint()
  let drag = false, moved = false
  btn.addEventListener('pointerdown', e => { drag = true; moved = false; btn.setPointerCapture(e.pointerId); btn.classList.add('dragging') })
  btn.addEventListener('pointermove', e => {
    if (!drag) return
    moved = true
    const r = hero.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const a = ap()
    const x = Math.round((e.clientX - r.left) / a) * a, y = Math.round((140 - Math.sin(t * Math.PI) * 60) / a) * a
    btn.style.left = `${x - btn.offsetWidth / 2}px`
    btn.style.right = 'auto'
    btn.style.top = `${y}px`
    btn.style.bottom = 'auto'
    set(HOURS[Math.min(3, Math.floor(t * 4))]!)
  })
  const release = async () => {
    if (!drag) return
    drag = false
    btn.classList.remove('dragging')
    if (!moved) return
    if (!RM()) {
      const r = btn.getBoundingClientRect()
      btn.style.cssText = ''
      const home = btn.getBoundingClientRect()
      await steps(btn, [3, 2, 1, 0].map(k => `translate(${((r.left - home.left) * k) / 4}px,${((r.top - home.top) * k) / 4}px)`), 100)
    }
    btn.style.cssText = ''
    set(now())
  }
  btn.addEventListener('pointerup', release)
  btn.addEventListener('pointercancel', release)
  btn.addEventListener('click', () => { if (moved) return; set(HOURS[(HOURS.indexOf(hour()) + 1) % 4]!) })
  keys.onEscape(() => { if (hour() === now() && !btn.style.cssText) return false; btn.style.cssText = ''; set(now()); return true })
}

/** Night: creatures sleep until the pointer comes near; fireflies gather at a still pointer. */
function night() {
  let woke = new WeakSet<Element>()
  let still: number | undefined, flies: HTMLElement[] = []
  const scatter = () => { for (const f of flies) f.remove(); flies = [] }
  hero.addEventListener('pointermove', e => {
    if (hour() !== 'night' || RM()) return
    for (const m of [...matesShown(), ...(you ? [you] : [])]) {
      const svg = m.querySelector('svg.spr')!
      const r = m.getBoundingClientRect()
      const near = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY) < 160
      if (near && svg.classList.contains('shut')) {
        svg.classList.remove('shut')
        if (!woke.has(m)) { woke.add(m); void pip(m, '!') }
      } else if (!near && !svg.classList.contains('shut') && m !== you) svg.classList.add('shut')
    }
    scatter()
    clearTimeout(still)
    const x = e.clientX, y = e.clientY
    still = window.setTimeout(() => {
      const r = hero.getBoundingClientRect(), a = ap()
      for (let i = 0; i < 6; i++) {
        const f = el('i', 'burst')
        f.style.background = '#e8f59a'
        f.style.left = `${x - r.left}px`
        f.style.top = `${y - r.top}px`
        hero.append(f)
        flies.push(f)
        const rad = 24 + (i % 3) * 8
        const frames = Array.from({ length: 20 }, (_, k) => {
          const ang = (k / 20) * Math.PI * 2 + i
          return `translate(${Math.round((Math.cos(ang) * rad) / a) * a}px,${Math.round((Math.sin(ang) * rad * 0.6) / a) * a}px)`
        })
        f.animate(frames.map((t, k) => ({ transform: t, offset: k / frames.length, easing: 'steps(1,end)' })).concat([{ transform: frames[0]!, offset: 1 }]), { duration: 2000, iterations: Infinity })
      }
    }, 1500)
  })
  hero.addEventListener('pointerleave', scatter)
  const sleepAll = () => {
    for (const m of matesShown()) m.querySelector('svg.spr')?.classList.toggle('shut', hour() === 'night')
    woke = new WeakSet()
  }
  onTeam(sleepAll)
  sleepAll()
}

/** Clicking a letter of the H1 drops it into the grass; it floats back after 1.5 s. */
function letters() {
  for (const g of $$<SVGGElement>('#meet-h .pw g')) {
    g.addEventListener('click', async () => {
      if (RM() || g.dataset.down) return
      g.dataset.down = '1'
      const f = [2, 5, 9, 14, 20, 27].map(y => `translateY(${y}px)`)
      await steps(g, [...f, 'translateY(22px)', 'translateY(27px)'], 60)
      g.style.transform = 'translateY(27px)'
      g.style.opacity = '0.0'
      await sleep(1500)
      g.style.transform = ''
      await steps(g, ['translateY(-6px)', 'translateY(-3px)', 'translateY(0)'], 80, { opacity: [0.3, 0.7, 1] })
      g.style.opacity = ''
      delete g.dataset.down
    })
  }
}

/** `spin`: every visible creature spins once, and the chip says Wheee. */
export function spinAll() {
  if (RM()) return
  for (const svg of $$<SVGSVGElement>('svg.spr')) {
    const r = svg.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight) continue
    void steps(svg, ['scaleX(.6)', 'scaleX(.25)', 'scaleX(-.25)', 'scaleX(-.6)', 'scaleX(-1)', 'scaleX(-.6)', 'scaleX(-.25)', 'scaleX(.25)', 'scaleX(.6)', 'scaleX(1)'], 60)
  }
  if (!chip) return
  const before = [...chip.childNodes]
  setChip('Wheee.')
  setTimeout(() => { if (chip.textContent === 'Wheee.') setChip(...before) }, 1200)
}

/** Copying makes every visible creature hop, 80 ms apart. */
export function cheer() {
  if (RM()) return
  $$<SVGSVGElement>('.mate svg.spr, .you svg.spr, .camper svg.spr').filter(s => s.getClientRects().length).forEach((s, i) => setTimeout(() => void hop(s), i * 80))
}

/**
 * Stars never sit among the words: any star within 10 px of the headline's letters, the lede or the
 * day's line is put out, so nothing reads as an accent on a letter. Runs again on resize.
 */
function cullStars() {
  const stars = $$<SVGPathElement>('.starfield .stars path')
  if (!stars.length) return
  const run = () => {
    const boxes = $$('#meet-h .pw, .hero .lede, .hero .today-m, .sunbtn:not(.still)').filter(n => n.getClientRects().length).map(n => n.getBoundingClientRect())
    for (const s of stars) {
      s.classList.remove('hid')
      const r = s.getBoundingClientRect()
      s.classList.toggle('hid', boxes.some(b => r.right > b.left - 10 && r.left < b.right + 10 && r.bottom > b.top - 10 && r.top < b.bottom + 10))
    }
  }
  run()
  let t: number | undefined
  addEventListener('resize', () => { clearTimeout(t); t = window.setTimeout(run, 150) })
}

function parallax() {
  if (RM()) return
  const layers: [HTMLElement | null, number][] = [[$('.sunbtn:not(.still)'), 0.3], [$('.lay.peaks'), 0.18], [$('.lay.hill'), 0.08]]
  let raf = 0, last = -1
  addEventListener('scroll', () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const a = ap(), y = Math.min(scrollY, hero.offsetHeight)
      if (y === last) return
      last = y
      for (const [n, k] of layers) if (n) n.style.translate = `0 ${Math.round((y * k) / a) * a}px`
    })
  }, { passive: true })
}

/** Hidden tab: the title rustles; on return the creature hops with a !. */
function tab() {
  const title = D.title
  D.addEventListener('visibilitychange', () => {
    if (D.hidden) { D.title = 'Something is rustling…'; return }
    D.title = title
    if (you) { void pip(you, '!', 400); void hop(youSvg()) }
  })
}

/** Hours: the regulars change with the hour (CSS swaps them); the sign speaks Shiny Hour in local time. */
function shinySign() {
  if (!W?.shinyHour) return
  const f = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  for (const n of $$('.ruletext')) n.textContent = `Shiny Hour runs ${f(W.shinyHour[0])} to ${f(W.shinyHour[1])} your time.`
}

export function startHero() {
  if (!W) return
  new IntersectionObserver(([e]) => { e?.isIntersecting ? hero.setAttribute('data-live', '') : hero.removeAttribute('data-live') }).observe(hero)
  for (const m of $$<HTMLButtonElement>('.mate')) {
    m.addEventListener('click', () => void familyMove(m))
    m.addEventListener('pointerenter', () => void hop(m.querySelector('svg.spr')))
    m.addEventListener('focus', () => void hop(m.querySelector('svg.spr')))
  }
  keys.on('meet', { '1': () => void meetNow() })
  // a fast swipe near an idle creature startles it into the grass
  let lx = 0, lt = 0
  hero.addEventListener('pointermove', e => {
    const now = performance.now(), v = lt ? Math.abs(e.clientX - lx) / Math.max(1, now - lt) : 0
    lx = e.clientX; lt = now
    if (v < 1.5 || RM()) return
    for (const m of [...matesShown(), ...(you && phase === 'met' ? [you] : [])]) {
      const r = m.getBoundingClientRect()
      if (Math.abs(r.left + r.width / 2 - e.clientX) > 80 || Math.abs(r.top + r.height / 2 - e.clientY) > 120 || m.dataset.ducking) continue
      m.dataset.ducking = '1'
      const svg = m.querySelector('svg.spr')!
      const a = ap()
      void pip(m, '!')
      void steps(svg, [`translateY(${2 * a}px)`, `translateY(${4 * a}px)`, `translateY(${6 * a}px)`], 100).then(async () => {
        ;(svg as SVGElement).style.transform = `translateY(${6 * a}px)`
        await sleep(1700)
        ;(svg as SVGElement).style.transform = `translateY(${4 * a}px)`
        await sleep(600)
        ;(svg as SVGElement).style.transform = ''
        delete m.dataset.ducking
      })
    }
  })
  grass(); lamps(); sun(); night(); letters(); parallax(); tab(); shinySign(); cullStars()
  addEventListener('resize', aimTail)
  $('[data-meetskip]')?.addEventListener('click', e => { if (!you) return; e.preventDefault(); you.focus() })
  if (restore()) {
    placeMet()
    const c = T.lead!
    const nn = el('button', '', 'Meet a new one')
    nn.type = 'button'
    nn.addEventListener('click', () => { holdFocus(chip); void meetNew() })
    setChip(cardName(c), ' kept your spot. ', nn)
    changed()
  } else void rustle()
  hooks.meetNew = () => void meetNew()
  onTeam(() => {
    // an evolution redraws the creature in place
    if (phase === 'met' && T.lead && you && T.lead.stage !== drawnStage) {
      drawnStage = T.lead.stage
      youSvg()?.replaceWith(sprite(T.lead))
      you.setAttribute('aria-label', `${cardName(T.lead)}, ${FAMILY_INFO[T.lead.family].name} teammate`)
      scan(you)
    }
  })
}

// The den (#collect): the pack ceremony with real slot odds (glowing backs, flips on f or by
// themselves every 1.2 s, a layered reveal, a summary), and the nest, where two cards fuse into a
// hybrid nobody has ever seen through the real fuse() once names.js has loaded.
import { cardName, fuse } from '../../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../../plugin/hooks/core/families.ts'
import { rngFromSeed, uint32 } from '../../../plugin/hooks/core/rng.ts'
import type { Species } from '../../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR } from '../../../plugin/hooks/ui/tokens.ts'
import { rollPack, siteCard } from '../../src/pages-meet.ts'
import type { PackSlot, SiteCard } from '../../src/pages-meet.ts'
import { shadowSvg } from '../../src/pages-sprite.ts'
import { spriteFor } from '../../../plugin/hooks/core/sprite.ts'
import { face, hideLayers, layered, spoken, tilt } from './card.ts'
import { scan } from './eyes.ts'
import * as keys from './keys.ts'
import { bindNames } from './names-stub.ts'
import { $, $$, D, el, flash, frag, pline, RM, say, settle, sleep, sprite, steps, wobble } from './util.ts'
import { hooks, hourFamily, onTeam, regulars, T, W } from './world.ts'

declare const __NAMES_URL__: string

const shelf = $('[data-shelf]')
const GLOW_WORD: Record<string, string> = { common: 'face down', rare: 'face down, glowing blue', epic: 'face down, glowing purple', legendary: 'face down, glowing gold' }

let slots: PackSlot[] = []
let flipped = 0, opening = false, timer: number | undefined, packN = 0

const rarityOf = (s: PackSlot) => ('card' in s ? s.card.rarity : 'legendary')

function paintPack() {
  const f = hourFamily()
  const pack = $<HTMLButtonElement>('[data-pack]')
  if (!pack) return
  pack.style.setProperty('--fam', FAMILY_COLOR[f])
  pack.dataset.fam = f
  pack.querySelector('.packtag')!.textContent = `${FAMILY_INFO[f].name} pack`
  pack.setAttribute('aria-label', `${FAMILY_INFO[f].name} pack. Open it.`)
}

/**
 * The opening (SPEC 13.5): the top crimp tears off in 3 frames, five backs fly out of the pack into
 * the slots on the plank, each glowing in its rarity's colour, and they turn over one by one.
 */
async function openPack() {
  if (!W || !shelf || opening) return
  opening = true
  const n = ++packN
  const fh = $('[data-fhint]')
  if (fh) fh.hidden = false
  const pack = $<HTMLButtonElement>('[data-pack]')!
  const fan = $<HTMLOListElement>('[data-fan]')!
  $('[data-summary]')!.hidden = true
  shelf.classList.remove('gold')
  // a revealed card that had focus ("o" pressed on it) hands it to the pack, as on the first opening
  if (fan.contains(D.activeElement)) pack.focus({ preventScroll: true })
  fan.replaceChildren()
  pack.classList.remove('torn')
  const rng = rngFromSeed('site-pack/' + Array.from(crypto.getRandomValues(new Uint8Array(8))).join('.'))
  slots = rollPack(W, hourFamily(), rng)
  if (W.preview?.legend === '1') slots[4] = { unfound: W.species.find(s => s.family === hourFamily() && s.legendary)! }
  // the tear: the pack braces, and the crimp rips up and away in 3 frames
  const top = pack.querySelector('.pk-top')
  await steps(pack, ['rotate(-3deg)', 'rotate(3deg)', 'none'], 90)
  await steps(top, ['translate(2px,-2px) rotate(-4deg)', 'translate(6px,-7px) rotate(-12deg)', 'translate(11px,-12px) rotate(-24deg)'], 110, { opacity: [1, 1, 0.5] })
  pack.classList.add('torn')
  flipped = 0
  fan.replaceChildren(...slots.map((s, i) => {
    const li = el('li')
    const r = rarityOf(s)
    const back = el('button', `back g-${r}`)
    back.type = 'button'
    back.setAttribute('aria-label', `Card ${i + 1} of 5, ${GLOW_WORD[r]}`)
    back.addEventListener('click', () => void flipAt(i))
    li.append(back)
    return li
  }))
  // each back flies from the pack's mouth into its slot
  if (!RM()) {
    const p = pack.getBoundingClientRect()
    await Promise.all($$<HTMLLIElement>('li', fan).map((li, i) => {
      const r = li.getBoundingClientRect()
      const dx = p.left + p.width / 2 - (r.left + r.width / 2), dy = p.top + 20 - (r.top + r.height / 2)
      return settle(li.animate([{ transform: `translate(${dx}px,${dy}px) scale(.35) rotate(-20deg)`, opacity: 0 }, { transform: `translate(${dx * 0.4}px,${dy - 60}px) scale(.7) rotate(-8deg)`, opacity: 1, offset: 0.45 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: i * 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }), 420 + i * 90)
    }))
  }
  if (RM()) { for (let i = 0; i < slots.length; i++) await flipAt(i, true); return }
  // the backs turn over by themselves until a keyboard visitor's focus is among them: from then on
  // they turn when Enter or f says so, never out from under the focus
  const typing = () => fan.contains(D.activeElement) && D.activeElement!.matches(':focus-visible')
  const auto = async () => {
    if (n !== packN || flipped >= slots.length || typing()) return
    await flipAt(flipped)
    timer = window.setTimeout(auto, 1200)
  }
  timer = window.setTimeout(auto, 900)
}

async function flipAt(i: number, instant = false) {
  const li = $$<HTMLLIElement>('[data-fan] li')[i]
  const s = slots[i]
  if (!li || !s || li.dataset.open) return
  li.dataset.open = '1'
  if (i >= flipped) flipped = i + 1
  else flipped = Math.max(flipped, $$('[data-fan] li[data-open]').length)
  const rare = rarityOf(s) !== 'common'
  const half = rare ? 400 : 175
  const back = li.firstElementChild as HTMLElement
  if (!instant) await settle(back.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: half, easing: 'ease-in', fill: 'forwards' }), half)
  // the back had the focus: the card that turns up in its place takes it
  const focused = li.contains(D.activeElement)
  const card = 'card' in s ? fusable(face(s.card), s.card) : goldSilhouette(s.unfound)
  if ('card' in s) {
    // the layered reveal: name, then rarity, the gene score counting up, the traits
    const parts = hideLayers(card, !instant)
    li.replaceChildren(card)
    if (focused) card.focus({ preventScroll: true })
    if (rare && !instant) await flash(card.querySelector('svg.spr'))
    if (!instant) void card.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: half, easing: 'ease-out' })
    // a focused card speaks for itself (its label is the same line)
    if (!focused) say(spoken(s.card))
    if (!instant && !RM()) void layered(card, parts, s.card)
    if (s.card.rarity === 'legendary') legendary()
  } else {
    li.replaceChildren(card)
    if (focused) card.focus({ preventScroll: true })
    else say('A legendary nobody has found yet.')
    legendary()
  }
  li.addEventListener('pointerdown', e => dragStart(e, li, s))
  scan(li)
  if ($$('[data-fan] li[data-open]').length === slots.length) done()
}

/**
 * A revealed pack card is also a button: a tap, Enter or Space puts it in the nest and fuses it, the
 * same as dragging it there (for touch, keyboards and anyone who would rather not drag).
 */
function fusable(card: HTMLElement, c: SiteCard): HTMLElement {
  card.setAttribute('role', 'button')
  card.tabIndex = 0
  card.setAttribute('aria-label', `${spoken(c)}. Put it in the nest to fuse it.`)
  card.querySelector('.cf-name')?.removeAttribute('tabindex')
  const go = () => {
    if (fusing) return
    nest.b = c
    paintSlot('b')
    say(`${cardName(c)} went into the nest.`)
    void fuseNow()
  }
  card.addEventListener('click', () => { if (!dragged) go() })
  card.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    go()
  })
  return card
}

function goldSilhouette(sp: Species): HTMLElement {
  const box = el('div', 'goldsil')
  box.tabIndex = -1
  box.append(frag(shadowSvg(spriteFor({ form: sp, stage: 3 }), 'shd')))
  box.append(el('p', '', 'A legendary nobody has found yet.'))
  return box
}

function legendary() {
  shelf?.classList.add('gold')
  const b = el('p', 'legend-banner')
  b.append(pline('Legendary!'))
  b.style.cssText = 'position:absolute;left:50%;top:0;transform:translateX(-50%);color:#f2b33d;z-index:20'
  ;(b.firstElementChild as HTMLElement).style.setProperty('--gp', '3px')
  $('.packstage')?.append(b)
  setTimeout(() => b.remove(), 1200)
}

function done() {
  clearTimeout(timer)
  const counts = { rare: 0, epic: 0, legendary: 0 }
  for (const s of slots) { const r = rarityOf(s); if (r !== 'common') counts[r]++ }
  const parts = (['rare', 'epic', 'legendary'] as const).filter(r => counts[r]).map(r => `${counts[r]} ${r}`)
  const kinds = new Set(slots.map(s => ('card' in s ? cardName(s.card) : s.unfound.id))).size
  const summary = $('[data-summary]')!
  summary.replaceChildren(
    el('p', 'big', `${parts.length ? `5 cards: ${parts.join(', ')}.` : '5 cards, all common.'} ${kinds} different creatures.`),
    el('p', 'soft', 'Tap one, or drag it onto the nest below, to fuse it. In the game, a pack charges for every 50 minutes Claude Code is open.'),
  )
  summary.hidden = false
  // the same button, the same key: it opens another
  const open = $('[data-open] .face')
  if (open) { open.replaceChildren('Open another ', el('span', 'kc1', 'o')) }
  $('[data-fhint]')!.hidden = true
  opening = false
}

// ---- the nest ------------------------------------------------------------------------------------

const nest: { a: SiteCard | null; b: SiteCard | null } = { a: null, b: null }
let fusing = false

/** A creature's few main colours as little squares, so a hybrid visibly carries both parents. */
function swatches(c: SiteCard, n = 3): HTMLElement {
  const count = new Map<number, number>()
  for (const r of spriteFor(c)) for (const v of r) if (v >= 0) count.set(v, (count.get(v) ?? 0) + 1)
  const lum = (v: number) => ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11
  const box = el('span', 'swatch')
  box.setAttribute('aria-hidden', 'true')
  for (const [v] of [...count].filter(([v]) => lum(v) > 40 && lum(v) < 235).sort((a, b) => b[1] - a[1]).slice(0, n)) {
    const i = el('i')
    i.style.setProperty('--c', '#' + v.toString(16).padStart(6, '0'))
    box.append(i)
  }
  return box
}

function paintSlot(which: 'a' | 'b') {
  const box = $(`[data-nslot="${which}"]`)
  const c = nest[which]
  if (!box || !c) return
  box.replaceChildren(sprite(c), el('span', 'nlabel', cardName(c)), swatches(c))
  scan(box)
}

function nestDefaults() {
  if (!W) return
  if (!nest.a || nest.a.id === 'you' || nest.a.id.startsWith('reg')) nest.a = T.met && T.lead ? T.lead : regulars()[0]
  if (!nest.b) {
    const f = W.species.find(s => s.id === W!.featured)!
    nest.b = siteCard(W, { species: f }, { rarity: 'common', shiny: false, foil: false, dna: uint32(rngFromSeed('nest/' + W.day)), id: 'nest-b' })
  }
  paintSlot('a')
  paintSlot('b')
}

/** Set by a drag that just ended, so the click that follows it is not also a tap. */
let dragged = false
/** Ends the drag in progress, if any, dropping nothing. */
let endDrag: (() => boolean) | null = null

/**
 * Drag a revealed pack card onto a nest slot with a mouse or pen, which take the card's gestures
 * (touch-action: none for fine pointers in the page's CSS). A finger scrolls the page instead and
 * taps a card to fuse it. A cancelled gesture or a new drag ends this one, so no sprite is ever left
 * following the pointer.
 */
function dragStart(e: PointerEvent, li: HTMLElement, s: PackSlot) {
  if (!('card' in s) || e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return
  endDrag?.()
  dragged = false
  const x0 = e.clientX, y0 = e.clientY, id = e.pointerId
  let ghost: HTMLElement | null = null
  const slotsEls = $$('[data-nslot]')
  const over = (x: number, y: number) => slotsEls.find(n => { const r = n.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom })
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
    if (!ghost) {
      ghost = sprite(s.card) as unknown as HTMLElement
      ghost.classList.add('flyer')
      Object.assign(ghost.style, { width: '64px', height: '64px' })
      D.body.append(ghost)
      void loadNames()
    }
    ghost.style.left = `${ev.clientX - 32}px`
    ghost.style.top = `${ev.clientY - 32}px`
    for (const n of slotsEls) n.classList.toggle('drop', n === over(ev.clientX, ev.clientY))
  }
  /** Stops listening and takes the sprite away; true when a sprite was out (a real drag). */
  const end = (): boolean => {
    D.removeEventListener('pointermove', move)
    D.removeEventListener('pointerup', up)
    D.removeEventListener('pointercancel', cancel)
    for (const n of slotsEls) n.classList.remove('drop')
    if (endDrag === end) endDrag = null
    const was = ghost !== null
    ghost?.remove()
    ghost = null
    return was
  }
  const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) end() }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id || !end()) return
    // the click that follows a drag is not a tap
    dragged = true
    setTimeout(() => { dragged = false })
    const t = over(ev.clientX, ev.clientY)
    if (t) {
      const which = t.dataset.nslot as 'a' | 'b'
      nest[which] = s.card
      paintSlot(which)
      void fuseNow()
    }
  }
  endDrag = end
  D.addEventListener('pointermove', move)
  D.addEventListener('pointerup', up)
  D.addEventListener('pointercancel', cancel)
}

let names: Promise<boolean> | null = null
function loadNames(): Promise<boolean> {
  names ??= import(/* @vite-ignore */ __NAMES_URL__).then(m => { bindNames(m); return true }, () => { names = null; return false })
  return names
}

/** The egg: the two parents' colours woven row by row, revealed bottom-up in `rows` rows. */
function eggSvg(a: SiteCard, b: SiteCard, rows: number, crack = 0): string {
  let pa = '', pb = '', pc = ''
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
    const nx = (x - 7.5) / 7.5, ny = (y - 11) / (y < 11 ? 11 : 9)
    if (nx * nx + ny * ny >= 1 || y < 20 - rows) continue
    ;((y >> 1) % 2 ? (pb += `M${x} ${y}h1v1h-1z`) : (pa += `M${x} ${y}h1v1h-1z`))
  }
  const cracks = [[], [[7, 6], [8, 7], [7, 8], [6, 9]], [[7, 6], [8, 7], [7, 8], [6, 9], [9, 6], [10, 5], [5, 10], [4, 9]]][crack] ?? []
  for (const [x, y] of cracks) pc += `M${x} ${y}h1v1h-1z`
  return `<svg viewBox="0 0 16 20" shape-rendering="crispEdges" aria-hidden="true"><path fill="${FAMILY_COLOR[a.family]}" d="${pa}"/><path fill="${FAMILY_COLOR[b.family]}" d="${pb}"/><path fill="#1d1726" d="${pc}"/></svg>`
}

async function fuseNow() {
  if (fusing || !W || !nest.a || !nest.b) return
  fusing = true
  const out = $('[data-nestout]')!
  const egg = $('[data-egg]')!
  out.replaceChildren()
  const ready = loadNames()
  const a = nest.a, b = nest.b
  // the parents glide to the middle, then weave into an egg
  const sa = $('[data-nslot="a"] svg.spr'), sb = $('[data-nslot="b"] svg.spr')
  if (!RM()) {
    const d = (n: Element | null) => { const r = n?.getBoundingClientRect(), e = egg.getBoundingClientRect(); return r ? e.left + e.width / 2 - (r.left + r.width / 2) : 0 }
    await Promise.all([sa, sb].map(n => n && settle(n.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${d(n)}px) scale(.5)`, opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }), 300)))
    for (const r of [5, 10, 15, 20]) { egg.innerHTML = eggSvg(a, b, r); await sleep(100) }
  } else egg.innerHTML = eggSvg(a, b, 20)
  // it wobbles 3 beats, and keeps wobbling while the names load (up to 5 s)
  const t0 = performance.now()
  let ok = false
  for (let beat = 0; ; beat++) {
    await wobble(egg)
    if (RM()) await sleep(200)
    const loaded = await Promise.race([ready, sleep(0).then(() => null)])
    if (beat >= 2 && loaded !== null) { ok = loaded; break }
    if (performance.now() - t0 > 5000) { ok = false; break }
  }
  let hybrid: SiteCard | null = null
  if (ok) {
    try {
      // a regular's colours only carry through as the head-top parent, so a species leads when it can
      const [pa, pb] = a.species === 'promo' && b.species !== 'promo' ? [b, a] : [a, b]
      const made = fuse(pa, pb, rngFromSeed('site-fuse/' + Array.from(crypto.getRandomValues(new Uint8Array(8))).join('.')), W.now)
      hybrid = { ...made, id: 'hybrid' } as SiteCard
    } catch { hybrid = null }
  }
  if (!hybrid) {
    egg.replaceChildren()
    out.replaceChildren(el('p', '', "The egg didn't hatch this time. Press Fuse to try again."))
    for (const n of [sa, sb]) n?.getAnimations().forEach(x => x.cancel())
    fusing = false
    return
  }
  for (const c of [1, 2]) { egg.innerHTML = eggSvg(a, b, 20, c); await sleep(100) }
  await sleep(200)
  egg.replaceChildren()
  const svg = sprite(hybrid)
  egg.append(svg)
  await flash(svg)
  // the hybrid as a real card, centred under the nest; it tilts under the pointer
  const card = face(hybrid, { level: true })
  const parts = hideLayers(card)
  tilt(card, card, true)
  const mix = el('p', 'mix')
  mix.append(swatches(a), ` ${cardName(a)} + ${cardName(b)} `, swatches(b))
  out.replaceChildren(card, mix, el('p', 'first', 'Nobody has ever seen this creature.'))
  say(`${spoken(hybrid)}. Nobody has ever seen this creature.`)
  scan(out)
  for (const n of [sa, sb]) n?.getAnimations().forEach(x => x.cancel())
  if (!RM()) void steps(card, ['translateY(12px) scale(.9)', 'translateY(-4px)', 'translateY(0)'], 90)
  await layered(card, parts, hybrid)
  egg.replaceChildren()
  fusing = false
}

export function startDen() {
  if (!W || !shelf) return
  paintPack()
  nestDefaults()
  onTeam(() => { paintPack(); if (!fusing) nestDefaults() })
  // a creature caught in the band above lands in the nest
  hooks.caught = c => { if (fusing) return; nest.b = c; paintSlot('b') }
  $('[data-pack]')?.addEventListener('click', () => void openPack())
  $('[data-open]')?.addEventListener('click', () => void openPack())
  $('[data-fuse]')?.addEventListener('click', () => void fuseNow())
  keys.on('collect', {
    o: () => { if (!opening) void openPack() },
    f: () => { if (opening) void flipAt(flipped) },
    '1': () => { if (!opening) void openPack() },
  })
  album()
}

/** The album: each family's row is one Tab stop, and the arrow keys, Home and End walk its nooks. */
function album() {
  for (const row of $$<HTMLElement>('[data-roving]')) {
    row.addEventListener('keydown', e => {
      const items = $$<HTMLButtonElement>('.nook', row)
      const i = items.indexOf(D.activeElement as HTMLButtonElement)
      if (i < 0) return
      const k = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key]
      if (k === undefined) return
      e.preventDefault()
      const next = items[(k + items.length) % items.length]!
      items.forEach(b => { b.tabIndex = b === next ? 0 : -1 })
      next.focus()
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
  const den = $('#collect')
  if (den) new IntersectionObserver(([e]) => { if (e?.isIntersecting) den.setAttribute('data-live', ''); else den.removeAttribute('data-live') }).observe(den)
}

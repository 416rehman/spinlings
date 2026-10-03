// The card face (SPEC 21's one component) built in the browser, every word set with textContent, the
// foil tilt with its holo band (site brief 2.5), and the catch ceremony both the meadow and the band
// play: a card back out of the creature, wobbles, a flip into the real card, then a flight home.
import { cardName, geneScore, xpToNext } from '../../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../../plugin/hooks/core/families.ts'
import { TRAITS } from '../../../plugin/hooks/core/traits.ts'
import { FAMILY_COLOR, FAMILY_MARK, RARITY_COLOR } from '../../../plugin/hooks/ui/tokens.ts'
import type { SiteCard } from '../../src/pages-meet.ts'
import { cap, clockOf, D, el, flash, H, pline, RM, setClock, settle, sleep, sprite, steps, wait, wobble } from './util.ts'
import type { MotionClock } from './clock.ts'

const PSKY: Record<string, string> = { haiku: '#dcefe2', sonnet: '#dbe6fa', opus: '#f8e0d3', fable: '#e7defa' }
const GENE_TIP = 'How good its four genes are. Each gene lifts or lowers one stat by up to 12%.'

export type FaceOptions = { big?: boolean; xp?: boolean; traits?: 'names' | 'full'; level?: boolean }

/** "Rare", "Rare · Foil", "Rare · Shiny Foil" (SPEC 14). */
export const rarityLine = (c: SiteCard) => cap(c.rarity) + (c.shiny || c.foil ? ` · ${[c.shiny ? 'Shiny' : '', c.foil ? 'Foil' : ''].filter(Boolean).join(' ')}` : '')

export function face(c: SiteCard, o: FaceOptions = {}): HTMLDivElement {
  const f = el('div', `cf${o.big ? ' big' : ''}${c.foil ? ' foil' : ''}${c.shiny ? ' shiny' : ''}`)
  f.style.setProperty('--fam', FAMILY_COLOR[c.family])
  f.style.setProperty('--rar', RARITY_COLOR[c.rarity])
  f.style.setProperty('--psky', PSKY[c.family]!)
  const art = el('div', 'cf-art')
  art.append(sprite(c))
  const name = el('p', 'cf-name', o.big ? '' : cardName(c))
  if (o.big) name.append(pline(cardName(c), 'pt', true), el('span', 'sr', cardName(c)))
  name.tabIndex = -1
  const kind = el('p', 'cf-kind')
  const mark = el('span', 'mark', FAMILY_MARK[c.family])
  mark.setAttribute('aria-hidden', 'true')
  kind.append(mark, ` ${FAMILY_INFO[c.family].name}`)
  if (o.level || o.xp) kind.append(el('span', 'lv', `Level ${c.level}`))
  f.append(art, name, el('p', 'cf-rar', rarityLine(c)), kind)
  if (o.xp) {
    const row = el('p', 'cf-row xp')
    const bar = el('span', 'bar')
    const i = el('i')
    const need = xpToNext(c.level)
    i.style.setProperty('--v', `${Math.round((c.xp / need) * 100)}%`)
    i.style.setProperty('--bc', '#5fbf8f')
    bar.append(i)
    row.append(el('b', '', `${c.xp} of ${need} xp`), bar)
    f.append(row)
  }
  const g = geneScore(c.genes)
  const genes = el('p', 'cf-row genes')
  genes.title = GENE_TIP
  const gb = el('span', 'bar')
  const gi = el('i')
  gi.style.setProperty('--v', `${g}%`)
  gb.append(gi)
  genes.append(el('b', '', `Gene quality ${g}%`), gb)
  f.append(genes)
  if (o.traits === 'full') {
    const ul = el('ul', 'cf-traits')
    for (const t of c.traits) {
      const li = el('li')
      li.append(el('b', '', TRAITS[t]?.name ?? t), ` ${TRAITS[t]?.text ?? ''}`)
      ul.append(li)
    }
    f.append(ul)
  } else f.append(el('p', 'cf-kind traits', c.traits.map(t => TRAITS[t]?.name ?? t).join(', ')))
  const holo = el('span', 'holo')
  holo.setAttribute('aria-hidden', 'true')
  f.append(holo)
  if (c.foil || c.shiny) tilt(f)
  return f
}

/** The reveal's layers (name, rarity, family, genes, traits), hidden until layered() shows them. */
export function hideLayers(card: HTMLElement, hide = true): (HTMLElement | null)[] {
  const parts = ['.cf-name', '.cf-rar', '.cf-kind:not(.traits)', '.genes', '.traits'].map(q => card.querySelector<HTMLElement>(q))
  if (hide && !RM()) for (const p of parts) if (p) p.style.visibility = 'hidden'
  return parts
}

/**
 * The layered reveal (SPEC 13.5): a foil's sheen sweeps once, then the name, the rarity, the gene
 * score counting up from 0, the traits with a small stamp; a shiny sparkles at two corners.
 */
export async function layered(card: HTMLElement, parts: (HTMLElement | null)[], c: SiteCard) {
  const clock = clockOf(card)
  const [name, rar, kind, genes, traits] = parts
  if (c.foil || c.shiny) { card.classList.add('sweep'); await sleep(450, clock); card.classList.remove('sweep') }
  if (name) name.style.visibility = ''
  await sleep(150, clock)
  for (const p of [rar, kind]) if (p) p.style.visibility = ''
  if (genes) {
    genes.style.visibility = ''
    const b = genes.querySelector('b')!, target = geneScore(c.genes)
    for (let k = 0; k <= 6; k++) { b.textContent = `Gene quality ${Math.round((target * k) / 6)}%`; await sleep(80, clock) }
  }
  await sleep(50, clock)
  if (traits) { traits.style.visibility = ''; void steps(traits, ['scale(1.3)', 'scale(1)'], 80) }
  if (c.shiny) for (const corner of ['4px auto auto 4px', '4px 4px auto auto']) {
    const sp = el('i', 'burst')
    sp.style.inset = corner
    sp.style.background = '#f2b33d'
    card.append(sp)
    void steps(sp, ['scale(1)', 'scale(3)', 'scale(1)'], 120).then(() => sp.remove())
  }
}

/**
 * Tilt: up to 8 degrees with perspective 800 px, the holo band following the pointer; springs back on
 * leave. Foil and shiny cards get the band; `any` lets a plain card tilt too (the big reveals).
 */
export function tilt(node: HTMLElement, target: HTMLElement = node, any = false) {
  if (RM()) return
  if (!any && !target.classList.contains('foil') && !target.classList.contains('shiny')) return
  node.addEventListener('pointermove', e => {
    if (clockOf(node)?.paused) return
    const r = node.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    target.style.transition = 'none'
    target.style.transform = `perspective(800px) rotateY(${(x * 16).toFixed(2)}deg) rotateX(${(-y * 16).toFixed(2)}deg)`
    target.style.setProperty('--hx', `${Math.round((x + 0.5) * 100)}%`)
    target.classList.add('tilting')
  })
  node.addEventListener('pointerleave', () => {
    if (clockOf(node)?.paused) return
    target.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1)'
    target.style.transform = ''
    target.classList.remove('tilting')
  })
}

/** "{Name}, epic Fable, genes 72%" for the live region. */
export const spoken = (c: SiteCard) => `${cardName(c)}, ${c.rarity} ${FAMILY_INFO[c.family].name}${c.shiny ? ', shiny' : ''}${c.foil ? ', foil' : ''}, gene quality ${geneScore(c.genes)}%`

/** 8 pixels radiate 6 art px in 3 frames. */
export function burst(host: HTMLElement, at = '40%') {
  const a = parseFloat(getComputedStyle(H).getPropertyValue('--ap')) || 3
  for (let i = 0; i < 8; i++) {
    const p = el('i', 'burst')
    const ang = (i / 8) * Math.PI * 2
    p.style.left = '50%'
    p.style.top = at
    host.append(p)
    void steps(p, [1, 2, 3].map(k => `translate(${Math.round(Math.cos(ang) * 3 * k) * a}px,${Math.round(Math.sin(ang) * 3 * k) * a}px)`), 80, { opacity: [1, 1, 0.5] }).then(() => p.remove())
  }
}

/**
 * The catch, big (SPEC 13.4 and 14): a card back grows out of `from`, wobbles a beat per rarity step,
 * holds still, turns over into the real card under "Gotcha!" (name, rarity, genes counting up, traits;
 * foil and shiny get their sheen, and it tilts under the pointer), rests a moment (a click sends it on),
 * then flies into `to`. Resolves false if `alive` turns false on the way.
 */
export async function catchCard(c: SiteCard, from: Element, o: { to?: () => Element | null; alive?: () => boolean; gotcha?: string; clock?: MotionClock } = {}): Promise<boolean> {
  const alive = o.alive ?? (() => true)
  const rv = el('div', 'rv')
  rv.style.setProperty('--glow', RARITY_COLOR[c.rarity])
  rv.setAttribute('aria-hidden', 'true')
  const inner = el('div', 'rv-in')
  inner.append(el('div', 'rv-back'))
  rv.append(el('div', 'rv-rays'), inner)
  const veil = el('div', 'veil')
  if (o.clock) { setClock(rv, o.clock); setClock(veil, o.clock) }
  D.body.append(veil, rv)
  H.classList.add('revealing')
  const done = () => { rv.remove(); H.classList.remove('revealing'); veil.classList.remove('on'); setTimeout(() => veil.remove(), 260) }
  // centred over the creature, kept inside the viewport and below the header
  const fr = from.getBoundingClientRect()
  const W = rv.offsetWidth, Hh = rv.offsetHeight
  const top0 = (parseFloat(getComputedStyle(H).getPropertyValue('--hdr')) || 64) + 56
  const x = Math.round(Math.max(12, Math.min(innerWidth - W - 12, fr.left + fr.width / 2 - W / 2)))
  const y = Math.round(Math.max(top0, Math.min(innerHeight - Hh - 48, fr.top - Hh * 0.6)))
  rv.style.left = `${x}px`
  rv.style.top = `${y}px`
  if (o.clock) o.clock.after(() => veil.classList.add('on'), 0)
  else requestAnimationFrame(() => veil.classList.add('on'))
  const motion = !RM()
  if (motion) {
    const k = fr.width / W
    const dx = fr.left + fr.width / 2 - (x + W / 2), dy = fr.top + fr.height / 2 - (y + Hh / 2)
    await settle(rv.animate([{ transform: `translate(${dx}px,${dy}px) scale(${(k * 0.62).toFixed(3)})` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1.15)' }), 420)
    await wobble(inner, c.rarity === 'common' ? 1 : c.rarity === 'rare' ? 2 : 3)
    await wait(300, o.clock)
  }
  if (!alive()) { done(); return false }
  const card = face(c, { level: true, big: true })
  const parts = hideLayers(card, motion)
  const half = c.rarity === 'common' ? 175 : 400
  if (motion) await settle(inner.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: half, easing: 'ease-in', fill: 'forwards' }), half)
  inner.getAnimations().forEach(a => a.cancel())
  inner.replaceChildren(card)
  rv.classList.add('lit')
  const gotcha = el('p', 'gotcha')
  gotcha.append(pline(o.gotcha ?? 'Gotcha!', 'pt', true))
  rv.append(gotcha)
  if (motion) {
    if (c.rarity !== 'common') await flash(card.querySelector('svg.spr'))
    void settle(inner.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0)' }], { duration: half, easing: 'cubic-bezier(.2,.8,.2,1.3)' }), half)
    void steps(gotcha, ['translate(-50%,8px)', 'translate(-50%,-4px)', 'translate(-50%,0)'], 80)
    burst(rv, '50%')
  }
  tilt(rv, card, true)
  let sent = false
  rv.addEventListener('click', () => { if (!o.clock?.paused) sent = true })
  if (motion) await layered(card, parts, c)
  // a moment to look at it (or a click to send it on)
  for (let t = 0; t < (c.rarity === 'common' ? 1300 : 1900) && !sent; t += 100) await wait(100, o.clock)
  veil.classList.remove('on')
  const to = o.to?.()
  if (motion && to && (to as HTMLElement).offsetParent !== null) {
    const r = rv.getBoundingClientRect(), s = to.getBoundingClientRect()
    card.classList.remove('tilting')
    gotcha.remove()
    rv.classList.remove('lit')
    await settle(rv.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${s.left + s.width / 2 - (r.left + r.width / 2)}px,${s.top + s.height / 2 - (r.top + r.height / 2)}px) scale(${Math.min(1, s.width / r.width).toFixed(3)})`, opacity: 0.4 }], { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }), 520)
  }
  done()
  return alive()
}

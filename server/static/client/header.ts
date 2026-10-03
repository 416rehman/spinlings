// The header (site brief 3): the wordmark's i-dots look at the pointer and blink; the walker (the
// lead's 8x8 mini) walks the trail as the page scrolls, bobbing, turning, standing, dozing after 20 s
// and waking with a !; the current stop gets aria-current; the team strip opens the card popover.
import { cardName } from '../../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../../plugin/hooks/core/families.ts'
import { miniSprite, spriteFor } from '../../../plugin/hooks/core/sprite.ts'
import type { SiteCard } from '../../src/pages-meet.ts'
import { spriteSvg } from '../../src/pages-sprite.ts'
import { openPopover } from './popover.ts'
import { $, $$, ap, D, frag, pip, pword, RM, sleep } from './util.ts'
import { hooks, onTeam, regulars, T } from './world.ts'

const top = $('#top')!
const mini = (c: SiteCard, cls = '') => frag<SVGSVGElement>(spriteSvg(miniSprite(spriteFor(c)), { cls }))

function solid() {
  const hero = $('#meet')
  if (!hero) return
  new IntersectionObserver(([e]) => top.classList.toggle('solid', !e?.isIntersecting), { rootMargin: '-88px 0px 0px 0px' }).observe($('.scene') ?? hero)
}

function wordmark() {
  const dots = $$<SVGPathElement>('.wm .dot')
  const brand = $('.brand')
  if (!dots.length || !brand) return
  let raf = 0
  D.addEventListener('pointermove', e => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const r = brand.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const ox = Math.abs(dx) > 40 ? Math.sign(dx) : 0
      for (const d of dots) d.style.transform = ox ? `translateX(${ox}px)` : ''
    })
  }, { passive: true })
  const blink = async () => {
    if (!RM() && !D.hidden) { for (const d of dots) d.style.opacity = '0'; await sleep(120); for (const d of dots) d.style.opacity = '' }
    setTimeout(blink, 5000 + Math.random() * 4000)
  }
  setTimeout(blink, 5000)
}

function walker() {
  const trail = $('.trail')
  const w = $('.walker')
  if (!trail || !w || !$('#meet')) return
  const stops = $$<HTMLAnchorElement>('.trail a[data-stop]')
  let last = scrollY, bob = 0, dozing = false, running = false
  const draw = () => {
    const c = T.met && T.lead ? T.lead : regulars()[0]
    w.replaceChildren(mini(c))
    const z = pword('z', 'pw')
    const zz = D.createElement('span')
    zz.className = 'zz'
    zz.append(z)
    w.append(zz)
    w.classList.add('on')
  }
  const place = () => {
    const first = stops[0]!.getBoundingClientRect(), lastStop = stops[stops.length - 1]!.getBoundingClientRect(), tr = trail.getBoundingClientRect()
    const max = D.documentElement.scrollHeight - innerHeight
    const p = max > 0 ? Math.min(1, scrollY / max) : 0
    const x0 = first.left + first.width / 2 - tr.left - 8, x1 = lastStop.left + lastStop.width / 2 - tr.left - 8
    const a = ap()
    w.style.setProperty('--wx', `${Math.round((x0 + (x1 - x0) * p) / a) * a}px`)
  }
  const svg = () => w.querySelector('svg.spr')
  // the walker only moves while the page does: a short run of frames per scroll, then it stands
  let ticking = false, still = 0, dozeTimer: number | undefined
  const doze = () => {
    if (RM() || D.hidden) return
    dozing = true
    svg()?.classList.add('shut')
    w.querySelector<HTMLElement>('.zz')?.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-10px)', opacity: 0 }], { duration: 2000, iterations: Infinity, easing: 'steps(4)' })
  }
  const tick = () => {
    const moving = Math.abs(scrollY - last) > 1
    if (moving) {
      w.classList.toggle('up', scrollY < last)
      still = 0
      bob = (bob + 1) % 2
      if (!RM()) (svg() as SVGElement | null)?.style.setProperty('transform', bob ? `translateY(${-ap() / 2}px)` : '')
      place()
    } else still += 1
    last = scrollY
    if (still >= 3 && !running) {
      ;(svg() as SVGElement | null)?.style.setProperty('transform', '')
      ticking = false
      dozeTimer = window.setTimeout(doze, 20_000)
      return
    }
    setTimeout(tick, running ? 60 : 120)
  }
  addEventListener('scroll', () => {
    clearTimeout(dozeTimer)
    if (dozing) {
      dozing = false
      svg()?.classList.remove('shut')
      w.querySelector('.zz')?.getAnimations().forEach(x => x.cancel())
      void pip(w, '!', 400)
    }
    if (!ticking) { ticking = true; tick() }
  }, { passive: true })
  for (const a of stops) a.addEventListener('click', e => {
    const t = D.getElementById(a.dataset.stop!)
    if (!t) return
    e.preventDefault()
    running = true
    t.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth' })
    history.replaceState(null, '', `#${a.dataset.stop}`)
    setTimeout(() => { running = false; t.querySelector<HTMLElement>('h2')?.focus?.() }, 900)
  })
  // the stop the page is at: the section crossing the viewport's middle
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue
      for (const a of stops) if (a.dataset.stop === e.target.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current')
    }
  }, { rootMargin: '-50% 0px -50% 0px' })
  for (const s of $$('main section[id]')) io.observe(s)
  onTeam(draw)
  draw()
  place()
  addEventListener('resize', place)
  dozeTimer = window.setTimeout(doze, 20_000)
}

function strip() {
  const slots = $$<HTMLButtonElement>('.slot')
  if (!slots.length) return
  const paint = () => {
    const [a, b] = regulars()
    const cards: (SiteCard | null)[] = [T.met ? T.lead : null, a, b]
    slots.forEach((s, i) => {
      const c = cards[i]
      const box = s.querySelector('.in2')!
      if (!c) {
        s.classList.add('empty')
        // the waiting wild one's shadow keeps its place in the team
        box.replaceChildren(T.lead ? mini(T.lead, 'sil') : pword('?', 'pw q'))
        s.title = 'Meet the wild one to fill this spot.'
        s.setAttribute('aria-label', 'Empty spot. Meet the wild one to fill this spot.')
        return
      }
      s.classList.remove('empty')
      box.replaceChildren(mini(c))
      s.title = cardName(c)
      s.setAttribute('aria-label', i === 0 ? `${cardName(c)}, your creature. Open its card.` : `${cardName(c)}, ${FAMILY_INFO[c.family].name} teammate. Open its card.`)
    })
  }
  slots.forEach((s, i) => s.addEventListener('click', () => {
    const [a, b] = regulars()
    if (i === 0) {
      if (!T.met || !T.lead) { $('#meet')?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth' }); return }
      openPopover(s, T.lead, true, {
        postcard: () => `${location.origin}/w/${T.seed}`,
        meetNew: () => hooks.meetNew(),
      })
    } else openPopover(s, i === 1 ? a : b, false)
  }))
  onTeam(paint)
  paint()
}

export function startHeader() {
  solid()
  wordmark()
  walker()
  strip()
}

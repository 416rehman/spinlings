// site.js: brings the meadow to life (SPEC 36). It makes no network requests (connect-src 'none');
// the only thing it ever fetches is names.js, a script, on the first fuse.
import { INSTALL_LINE } from './text.ts'
import { start as startEyes } from './eyes.ts'
import { startHeader } from './header.ts'
import { cheer, spinAll, startHero } from './hero.ts'
import * as keys from './keys.ts'
import { closePopover, isOpen } from './popover.ts'
import { startPlaces } from './places.ts'
import { $, $$, copyText, D, el, hop, isMac, RM, selectText, sleep } from './util.ts'
import { W } from './world.ts'

/** Copy buttons on every prompt box: the label answers, the creatures hop, and a refusal selects the line. */
function copies() {
  for (const b of $$<HTMLButtonElement>('[data-copy]')) {
    const label = b.querySelector('.face')!
    const code = b.closest('.prompt')?.querySelector('code')
    b.addEventListener('click', async () => {
      const ok = await copyText(code?.textContent ?? INSTALL_LINE)
      if (!ok && code) selectText(code)
      label.textContent = ok ? 'Copied. Paste it into Claude Code.' : `Press ${isMac() ? '⌘C' : 'Ctrl+C'} to copy.`
      if (ok) cheer()
      setTimeout(() => { label.textContent = 'Copy' }, 2400)
    })
  }
}

/**
 * The footer's napper wakes with a hop when clicked, mumbles a secret (typing s-p-i-n anywhere spins
 * every creature in view), and nods off again after 3 s.
 */
function napper() {
  const n = $<HTMLButtonElement>('.foot .napper')
  if (!n) return
  const tip = el('span', 'nsay', 'Psst. Type spin.')
  tip.setAttribute('aria-hidden', 'true')
  n.append(tip)
  n.addEventListener('click', async () => {
    const svg = n.querySelector('svg.spr')
    svg?.classList.remove('shut')
    n.classList.add('awake')
    await hop(svg)
    await sleep(3000)
    svg?.classList.add('shut')
    n.classList.remove('awake')
  })
}

/**
 * Toys (pages-landing.ts): without scripts each is a picture or text, since a button there would
 * promise a press that does nothing. Here each [data-toy] becomes the button it is, keeping its class,
 * data and children, and taking its label (data-toy, when given) and shortcut (data-keys).
 */
function toys() {
  for (const n of $$('[data-toy]')) {
    const b = el('button')
    b.type = 'button'
    for (const a of n.getAttributeNames()) if (!['data-toy', 'data-keys', 'role', 'aria-hidden'].includes(a)) b.setAttribute(a, n.getAttribute(a)!)
    if (n.dataset.toy) b.setAttribute('aria-label', n.dataset.toy)
    if (n.dataset.keys) b.setAttribute('aria-keyshortcuts', n.dataset.keys)
    b.append(...n.childNodes)
    n.replaceWith(b)
  }
}

/** Dev preview only: LCP and CLS in a corner. */
function perf() {
  if (W?.preview?.perf !== '1') return
  const box = el('p', 'perf', 'LCP … CLS 0.000')
  D.body.append(box)
  let lcp = 0, cls = 0
  const paint = () => { box.textContent = `LCP ${Math.round(lcp)} ms  CLS ${cls.toFixed(3)}` }
  new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = e.startTime; paint() }).observe({ type: 'largest-contentful-paint', buffered: true })
  new PerformanceObserver(l => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) cls += e.value; paint() }).observe({ type: 'layout-shift', buffered: true })
}

/**
 * A section's own code (the battle engine, the den's packs and nest) loads, from this origin, once the
 * section comes within a screen of view, so the first screen only pays for the meadow.
 */
function soon(sel: string, load: () => Promise<unknown>) {
  const n = $(sel)
  if (!n) return
  const io = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return
    io.disconnect()
    load().catch(() => {})
  }, { rootMargin: '100% 0px' })
  io.observe(n)
}

function boot() {
  toys()
  D.addEventListener('visibilitychange', () => D.documentElement.toggleAttribute('data-hidden', D.hidden))
  keys.start()
  keys.onEscape(() => { if (!isOpen()) return false; closePopover(); return true })
  keys.onSpin(spinAll)
  copies()
  napper()
  if (W && $('#meet')) {
    startHero()
    startHeader()
    soon('#battle', () => import('./battle.ts').then(m => m.startBattle()))
    soon('#collect', () => import('./den.ts').then(m => m.startDen()))
  }
  startPlaces()
  startEyes()
  perf()
  void RM
}

boot()

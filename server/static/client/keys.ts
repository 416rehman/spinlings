// Keys (site brief 2.8): 1 is the active section's primary action, o opens, f flips, Esc closes or
// returns the sun to now. The active section is the one crossing the viewport's middle. Keys are
// ignored with modifiers, inside fields and when the footer toggle turns them off (WCAG 2.1.4).
import { $, $$, D, store } from './util.ts'

type Handlers = Partial<Record<'1' | 'o' | 'f', () => void>>
const scopes = new Map<string, Handlers>()
let active = 'meet'
const escapes: (() => boolean)[] = []
let typed = ''
let spinFn: (() => void) | null = null

export const on = (section: string, h: Handlers) => scopes.set(section, { ...scopes.get(section), ...h })
/** An Esc handler; it returns true when it handled the key. */
export const onEscape = (fn: () => boolean) => { escapes.push(fn) }
export const onSpin = (fn: () => void) => { spinFn = fn }

export const enabled = () => store.get()?.shortcuts !== false

export function start() {
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) active = e.target.id }, { rootMargin: '-50% 0px -50% 0px' })
  for (const s of $$('main section[id]')) io.observe(s)

  const toggle = $<HTMLButtonElement>('[data-keys]')
  const paint = () => {
    if (!toggle) return
    toggle.setAttribute('aria-pressed', String(enabled()))
  }
  toggle?.addEventListener('click', () => { store.set({ shortcuts: !enabled() }); paint() })
  paint()

  D.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    const t = e.target
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return
    if (e.key === 'Escape') { for (const f of escapes) if (f()) { e.preventDefault(); return } return }
    if (!enabled() || e.repeat) return
    const k = e.key.toLowerCase()
    typed = (typed + k).slice(-4)
    if (typed === 'spin' && spinFn) { spinFn(); typed = '' }
    if (k !== '1' && k !== 'o' && k !== 'f') return
    const h = scopes.get(active)?.[k as '1' | 'o' | 'f'] ?? scopes.get('page')?.[k as '1' | 'o' | 'f']
    if (h) { e.preventDefault(); h() }
  })
}

// The card popover under the header's team strip (a bottom sheet on phones): the full card, and for
// the visitor's own creature a postcard link and "Meet a new one". Focus moves to the card's name,
// stays inside while open, and returns to the slot on Esc, the close button or a click outside.
import { cardName } from '../../../plugin/hooks/core/cards.ts'
import type { SiteCard } from '../../src/pages-meet.ts'
import { face } from './card.ts'
import { $$, copyText, D, el, frag } from './util.ts'

let open: { box: HTMLDivElement; from: HTMLElement; off: () => void } | null = null

const CLOSE = '<svg viewBox="0 0 7 7" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="M0 0h2v1h-2zM1 1h2v1h-2zM2 2h3v1h-3zM2 3h3v1h-3zM2 4h3v1h-3zM4 1h2v1h-2zM5 0h2v1h-2zM1 5h2v1h-2zM0 6h2v1h-2zM4 5h2v1h-2zM5 6h2v1h-2z"/></svg>'

export const isOpen = () => open !== null

export function closePopover() {
  if (!open) return
  const { box, from, off } = open
  open = null
  off()
  box.remove()
  from.focus()
}

export type PopoverActions = { postcard?: () => string; meetNew?: () => void }

export function openPopover(from: HTMLElement, card: SiteCard, own: boolean, acts: PopoverActions = {}) {
  closePopover()
  const box = el('div', 'pop')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', cardName(card))
  const x = el('button', 'x')
  x.type = 'button'
  x.setAttribute('aria-label', 'Close')
  x.append(frag(CLOSE))
  const f = face(card, { xp: own, level: !own, traits: 'full' })
  box.append(x, f)
  if (own) {
    const row = el('div', 'acts')
    const pc = el('button', 'pbtn')
    pc.type = 'button'
    const label = el('span', 'face', 'Send a postcard')
    pc.append(label)
    pc.addEventListener('click', async () => {
      const ok = await copyText(acts.postcard?.() ?? '')
      label.textContent = ok ? 'Postcard link copied.' : (acts.postcard?.() ?? '')
      setTimeout(() => { label.textContent = 'Send a postcard' }, 2400)
    })
    const nn = el('button', 'tbtn', 'Meet a new one')
    nn.type = 'button'
    nn.addEventListener('click', () => { closePopover(); acts.meetNew?.() })
    row.append(pc, nn)
    box.append(row, el('p', 'line', `${cardName(card)} lives on this page. The ones you keep are out in the grass, inside Claude Code.`))
  } else box.append(el('p', 'line', 'A meadow regular. It lives on this page.'))
  D.body.append(box)
  const r = from.getBoundingClientRect()
  box.style.top = `${Math.round(r.bottom + 8)}px`
  box.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, r.right - box.offsetWidth)))}px`
  const name = f.querySelector<HTMLElement>('.cf-name')!
  name.focus()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); closePopover() }
    if (e.key === 'Tab') {
      const items = $$<HTMLElement>('button, a[href], [tabindex="-1"]', box).filter(n => n.offsetParent !== null)
      const first = items[0]!, last = items[items.length - 1]!
      if (e.shiftKey && (D.activeElement === first || D.activeElement === name)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
  const onDown = (e: PointerEvent) => { if (!box.contains(e.target as Node) && !from.contains(e.target as Node)) closePopover() }
  x.addEventListener('click', closePopover)
  D.addEventListener('keydown', onKey, true)
  setTimeout(() => D.addEventListener('pointerdown', onDown, true))
  open = { box, from, off: () => { D.removeEventListener('keydown', onKey, true); D.removeEventListener('pointerdown', onDown, true) } }
}

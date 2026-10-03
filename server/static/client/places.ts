// The night market's present, the campfire (team, flare, the shadow of what the lead becomes, the
// postcard), and the small toys of the other pages: a card that tilts and hops when poked, a gift's
// present, a drop's egg that cracks a little more with each tap but never hatches.
import { cardName } from '../../../plugin/hooks/core/cards.ts'
import { FAMILIES } from '../../../plugin/hooks/core/families.ts'
import { pick, rngFromSeed } from '../../../plugin/hooks/core/rng.ts'
import { rollSlot } from '../../src/pages-meet.ts'
import { face, spoken, tilt } from './card.ts'
import { scan } from './eyes.ts'
import * as keys from './keys.ts'
import { $, copyText, D, el, flash, hop, RM, say, sleep, sprite, steps, wait, wobble } from './util.ts'
import { onTeam, postcardUrl, regulars, T, W } from './world.ts'

// ---- the present -------------------------------------------------------------------------------------

async function unwrap(stall: HTMLElement, card: () => HTMLElement | null) {
  if (stall.classList.contains('open') || stall.dataset.busy) return
  stall.dataset.busy = '1'
  const box = stall.querySelector<HTMLElement>('[data-present]')!
  const lid = box.querySelector('.lid'), ribbon = box.querySelectorAll('.box .pr')
  if (!RM()) {
    // the ribbon pulls in 3 frames, the lid pops 6 art px and falls aside
    for (let k = 0; k < 3; k++) { ribbon.forEach(r => r.setAttribute('transform', `translate(0 ${-k})`)); await sleep(100) }
    ribbon.forEach(r => r.setAttribute('opacity', '0'))
    await steps(lid, ['translate(0px,-2px)', 'translate(0px,-4px)', 'translate(0px,-6px)', 'translate(3px,-5px) rotate(12deg)', 'translate(7px,-1px) rotate(30deg)', 'translate(9px,4px) rotate(60deg)'], 70)
    await wait(200)
    await flash(box.querySelector('svg'))
  }
  const c = card()
  if (c) stall.querySelector('[data-giftcard], .giftcard')?.replaceChildren(c)
  // the present is about to vanish: if it had focus, the card it held takes it (the name, or the
  // legendary's line), and the live region says what came out
  const had = box.contains(D.activeElement)
  stall.classList.add('open')
  ribbon.forEach(r => { r.removeAttribute('opacity'); r.removeAttribute('transform') })
  delete stall.dataset.busy
  const shown = stall.querySelector<HTMLElement>('.giftcard .cf')
  const target = stall.querySelector<HTMLElement>('.giftcard .cf-name') ?? stall.querySelector<HTMLElement>('.giftcard > p')
  if (had && target) { target.tabIndex = -1; target.focus({ preventScroll: true }) }
  if (shown) {
    tilt(shown, shown, true)
    if (!RM()) void steps(shown, ['translateY(24px) scale(.7)', 'translateY(-10px) scale(1.04)', 'translateY(0) scale(1)'], 90)
    scan(shown)
  }
}

function market() {
  const stall = $('[data-giftstall]')
  if (!stall || !W) return
  const w = W
  const open = () => unwrap(stall, () => {
    const rng = rngFromSeed('site-gift/' + Array.from(crypto.getRandomValues(new Uint8Array(8))).join('.'))
    const s = rollSlot(w, pick(rng, FAMILIES), rng, false)
    if (!('card' in s)) { const p = el('p', '', 'A legendary nobody has found yet.'); say(p.textContent!); return p }
    say(spoken(s.card))
    return face(s.card)
  })
  $('[data-present]')?.addEventListener('click', () => void open())
  $('[data-rewrap]')?.addEventListener('click', () => { stall.classList.remove('open'); $('[data-present]')?.focus() })
  keys.on('trade', { o: () => void open(), '1': () => void open() })
  // the Trader on the cart roof hops and says a line when poked, and answers for a deal tag you touch
  const trader = $('.trader')
  if (trader) {
    const lines = ['I came a long way to be here.', 'Everything here was found in tall grass.', 'Mind the wheels. They squeak.', 'I only take spare cards. Never your team.', 'Those lanterns? Each one is a Mythic.']
    let k = 0, t: number | undefined
    const bubble = el('span', 'say')
    trader.append(bubble)
    const talk = (line: string) => {
      void hop(trader.querySelector('svg.spr'))
      bubble.textContent = line
      trader.classList.add('talk')
      clearTimeout(t)
      t = window.setTimeout(() => trader.classList.remove('talk'), 2200)
    }
    trader.addEventListener('click', () => talk(lines[k++ % lines.length]!))
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-deal]')) {
      b.addEventListener('click', () => { talk(`${b.dataset.deal}? A fine pick.`); say(`The Trader likes ${b.dataset.deal}. Deals are on the trade board inside Claude Code.`) })
    }
  }
  const market = $('#trade')
  if (market) new IntersectionObserver(([e]) => { e?.isIntersecting ? market.setAttribute('data-live', '') : market.removeAttribute('data-live') }).observe(market)
}

// ---- the campfire ------------------------------------------------------------------------------------

/** Every fireside (the landing's, a trainer's camp): it flickers while in view and flares when stoked. */
function fires() {
  const side = $('.fireside'), fire = $<HTMLButtonElement>('[data-fire]')
  if (!side || !fire) return
  new IntersectionObserver(([e]) => { e?.isIntersecting ? side.setAttribute('data-live', '') : side.removeAttribute('data-live') }).observe(side)
  let busy = false
  const flare = async () => {
    if (busy) return
    busy = true
    if (!RM()) fire.classList.add('flare')
    fire.dispatchEvent(new Event('flare'))
    for (const c of side.querySelectorAll('.camper svg.spr')) void hop(c)
    await sleep(600)
    fire.classList.remove('flare')
    await sleep(900)
    busy = false
  }
  fire.addEventListener('click', () => void flare())
  fire.addEventListener('pointerenter', () => void flare())
  fire.addEventListener('focus', () => void flare())
}

function camp() {
  const side = $('.fireside')
  if (!side || !W) return
  const campers = $('[data-campers]')!
  const shadow = $('[data-shadow]')!
  const caption = $('[data-oneday]')!
  const pc = $<HTMLButtonElement>('[data-postcard]')
  // the empty log, kept for the visitor's own creature until they meet it
  const seat = campers.querySelector('.seat')
  const draw = () => {
    const [a, b] = regulars()
    const lead = T.met && T.lead ? T.lead : a
    const team = T.met && T.lead ? [b, a, T.lead] : [b, a]
    campers.replaceChildren(...team.map((c, i) => { const s = el('span', `camper${i === team.length - 1 ? ' lead' : ''}`); s.append(sprite(c)); return s }), ...(T.met || !seat ? [] : [seat]))
    const grown = { ...lead, level: Math.max(8, lead.level), stage: 3 as const }
    shadow.replaceChildren(sprite(grown, 'sil'))
    caption.textContent = `One day: ${cardName(grown)}.`
    scan(campers)
    if (pc) {
      pc.hidden = !(T.met && T.lead)
      if (T.met && T.lead) pc.querySelector('.face')!.textContent = `Send ${cardName(T.lead)} to a friend`
    }
  }
  onTeam(draw)
  draw()
  // the flare lights the rock: the shadow shows its colours and the caption names what the lead becomes
  $('[data-fire]')?.addEventListener('flare', async () => {
    shadow.classList.add('color')
    caption.classList.add('on')
    await sleep(600)
    shadow.classList.remove('color')
    await sleep(900)
    caption.classList.remove('on')
  })
  pc?.addEventListener('click', async () => {
    if (!T.seed) return
    const url = postcardUrl()
    const label = pc.querySelector('.face')!
    label.textContent = (await copyText(url)) ? 'Postcard link copied.' : url
    setTimeout(() => { if (T.lead) label.textContent = `Send ${cardName(T.lead)} to a friend` }, 2400)
  })
  keys.on('install', { '1': () => $<HTMLButtonElement>('#install2-cmd')?.closest('.install')?.querySelector<HTMLButtonElement>('[data-copy]')?.click() })
}

// ---- the other pages ----------------------------------------------------------------------------

/** The card page: the big card tilts under the pointer (and shimmers when foil or shiny); poke it and it hops. */
function cardPage() {
  const box = $('[data-bigcard]'), card = $('[data-bigcard] .cf')
  const poke = $<HTMLButtonElement>('[data-bigcard] .poke')
  if (!box || !card || !poke) return
  tilt(box, card, true)
  poke.addEventListener('click', () => void hop(poke.querySelector('svg.spr')))
  poke.addEventListener('pointerenter', () => void hop(poke.querySelector('svg.spr')))
  // a foil or shiny card catches the light once as the page opens
  if (!RM() && (card.classList.contains('foil') || card.classList.contains('shiny'))) {
    setTimeout(() => { card.classList.add('sweep'); setTimeout(() => card.classList.remove('sweep'), 700) }, 500)
  }
}

function giftPage() {
  const stall = $('main [data-giftstall]')
  if (!stall || $('#trade')) return
  // the card is already on the page, under the wrapping: say what it is as it comes out, the way the
  // landing's cards are spoken (card.ts spoken)
  const line = () => {
    const q = (sel: string) => stall.querySelector(`.giftcard ${sel}`)?.textContent?.trim() ?? ''
    const [rarity = '', finish = ''] = q('.cf-rar').toLowerCase().split(' · ')
    const family = [...(stall.querySelector('.giftcard .cf-kind')?.childNodes ?? [])].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()
    return [q('.cf-name'), `${rarity} ${family}`.trim(), finish, q('.genes b').toLowerCase()].filter(Boolean).join(', ')
  }
  const go = () => void unwrap(stall, () => { say(`${line()}. It's yours once you claim it.`); return null })
  $('[data-present]')?.addEventListener('click', go)
  // a gift page has no sections: its keys belong to the page itself
  keys.on('page', { o: go, '1': go })
}

function dropPage() {
  const egg = $<HTMLButtonElement>('[data-egg]')
  if (!egg) return
  egg.addEventListener('click', async () => {
    void wobble(egg)
    // one more crack pixel each tap; it never hatches here
    const g = egg.querySelector('.extra')
    if (g && g.childElementCount < 14) {
      const n = g.childElementCount, a = 6 + (n % 5), b = 4 + Math.floor(n / 2)
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', `M${a} ${b}h1v1h-1z`)
      p.setAttribute('fill', '#2a1d18')
      g.append(p)
    }
  })
}

export function startPlaces() {
  market()
  camp()
  fires()
  cardPage()
  giftPage()
  dropPage()
}

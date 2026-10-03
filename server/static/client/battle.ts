// The band demo (site brief 5): Claude's transcript fills the frame while the spinner fast-forwards
// to 20 s, then the band rises from the prompt and pushes the transcript up, and the real engine
// (simulateBattle, today's rule, RULES_VERSION) plays a wild battle. In the round the team's special
// fires, [1] Now! winds up; a press re-simulates with that round added, so earlier rounds never
// change, and the hit lands as a Perfect. A win rolls the catch (the first always stays, as in the
// game): the wild one spins into a card back, wobbles, and either turns over into its card or slips
// away. A win also evolves the visitor's creature.
import { RULES_VERSION, participants, simulateBattle } from '../../../plugin/hooks/core/battle.ts'
import { cardName, xpToNext } from '../../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO, SPECIALS } from '../../../plugin/hooks/core/families.ts'
import { rngFromSeed } from '../../../plugin/hooks/core/rng.ts'
import { TRAITS } from '../../../plugin/hooks/core/traits.ts'
import type { BattleAction, BattleLog, BattleSetup, Family } from '../../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, FAMILY_MARK, RARITY_COLOR, hpColor } from '../../../plugin/hooks/ui/tokens.ts'
import { ARENA, wildCard } from '../../src/pages-meet.ts'
import type { SiteCard } from '../../src/pages-meet.ts'
import { catchCard } from './card.ts'
import { lookAt, scan } from './eyes.ts'
import * as keys from './keys.ts'
import { $, $$, ap, D, el, flash, hop, pip, pline, pword, RM, say, shake, sprite, steps, wait, wobble } from './util.ts'
import { commit, growth, hooks, hourFamily, onTeam, T, team, W } from './world.ts'

const VERBS = ['Rustling', 'Foraging', 'Puddle-hopping', 'Nesting', 'Dawdling', 'Meandering', 'Burrowing', 'Pottering']

const demo = $('[data-demo]')
const screen = $('[data-screen]')
let arena: Family = 'fable', next: Family | null = null
let running = false, started = false
let windowOpen: (() => void) | null = null
let perfects = 0, wins = 0

const pace = () => ECONOMY.battle.roundMs
const fam = (f: Family) => FAMILY_INFO[f].name
const narrow = () => innerWidth < 420

function paintArena(f: Family, animate: boolean) {
  if (!demo) return
  const from = [demo.style.getPropertyValue('--psky'), demo.style.getPropertyValue('--pground'), demo.style.getPropertyValue('--pshade')]
  const to = ARENA[f]
  const vars = ['--psky', '--pground', '--pshade']
  if (!animate || RM() || !from[0]) vars.forEach((v, i) => demo.style.setProperty(v, to[i]!))
  else [1, 2, 3, 4].forEach(k => setTimeout(() => vars.forEach((v, i) => demo.style.setProperty(v, k === 4 ? to[i]! : `color-mix(in srgb,${to[i]} ${k * 25}%,${from[i]})`)), (k - 1) * 100))
  const chip = $('[data-model]')
  if (chip) {
    chip.style.setProperty('--fam', FAMILY_COLOR[f])
    chip.querySelector('.mark')!.textContent = FAMILY_MARK[f]
    chip.querySelector('.v')!.textContent = fam(f)
  }
  $('.spinner .flower')?.setAttribute('style', `color:${FAMILY_COLOR[f]}`)
  caption()
}

function caption() {
  const cap = $('[data-cap]')
  if (!cap) return
  cap.textContent = next && running ? `Next battle: ${fam(next)}` : `Arena: ${fam(arena)}. ${fam(arena)} creatures hit 10% harder here.`
}

function controls() {
  const model = $('[data-model]'), spin = $('.spinner:not(.still)')
  model?.addEventListener('click', () => {
    const f = FAMILIES[(FAMILIES.indexOf(next ?? arena) + 1) % 4]!
    if (running) {
      next = f
      model.querySelector('.v')!.textContent = `Next battle: ${fam(f)}`
      caption()
    } else { arena = f; paintArena(f, true) }
  })
  let verb = 0
  spin?.addEventListener('click', () => {
    verb = (verb + 1) % VERBS.length
    spin.querySelector('.verb')!.textContent = `${VERBS[verb]}…`
    if (RM()) return
    spin.classList.add('go', 'fast')
    setTimeout(() => { spin.classList.remove('fast'); if (!running) spin.classList.remove('go') }, 1000)
  })
  $('[data-key1]')?.addEventListener('click', press)
  $('[data-band]')?.addEventListener('click', press)
  $('[data-start]')?.addEventListener('click', () => void run())
}

/** A press: Perfect in a wind-up, a ? pip otherwise, or Battle again after the result. */
function press() {
  const key = $('[data-key1]')
  key?.classList.add('pressed')
  setTimeout(() => key?.classList.remove('pressed'), 120)
  if (windowOpen) { windowOpen(); return }
  if (!running) { void run(); return }
  const act = $('.side.sa .fighter.act')
  if (act) { void pip(act, '?'); void steps(act.querySelector('svg.spr'), ['scaleX(-1)', 'scaleX(-1)', 'scaleX(1)'], 200) }
}

type Fighter = { card: SiteCard; node: HTMLElement; svg: SVGSVGElement; hp: number; max: number }

function fighterNode(c: SiteCard, silent = false): Fighter {
  const node = el('div', 'fighter')
  const hp = el('span', 'hp')
  const i = el('i')
  i.style.setProperty('--v', '100%')
  hp.append(i)
  const svg = sprite(c)
  if (silent) svg.classList.add('sil')
  node.append(el('span', 'nm', cardName(c)), hp, svg)
  return { card: c, node, svg, hp: 1, max: 1 }
}

/** The empty third spot until the visitor meets their creature: its shadow, waiting at the back. */
function ghost(): HTMLElement {
  const node = el('div', 'fighter ghost')
  node.append(el('span', 'nm'), el('span', 'hp'))
  if (T.lead) node.append(sprite(T.lead, 'sil'))
  const q = el('span', 'q')
  q.append(pword('?'))
  node.append(q)
  return node
}

function setHp(f: Fighter, hp: number) {
  f.hp = Math.max(0, hp)
  const i = f.node.querySelector<HTMLElement>('.hp i')!
  const frac = f.max ? f.hp / f.max : 0
  i.style.setProperty('--v', `${Math.round(frac * 100)}%`)
  i.style.setProperty('--hc', hpColor(frac))
}

let bannerToken = 0
/** The band's one line, in pixel type; a shorter line on narrow screens so it never wraps. */
async function banner(text: string, ms = 0, gold = false, short = text) {
  const b = $('[data-banner]')
  if (!b) return
  const t = ++bannerToken
  b.replaceChildren(pline(narrow() ? short : text, 'pt bpt'))
  b.classList.toggle('gold', gold)
  if (ms) { await wait(ms); if (t === bannerToken) b.replaceChildren() }
}
const clearBanner = () => { bannerToken++; $('[data-banner]')?.replaceChildren() }

/** A number over a fighter: it rises and fades, or under reduced motion simply shows for as long, then goes. */
async function float(d: HTMLElement, frames: string[], ms: number, opacity: number[]) {
  if (RM()) await wait(frames.length * ms)
  else await steps(d, frames, ms, { opacity })
  d.remove()
}

async function popNumber(target: Fighter, n: number, big: boolean) {
  const d = el('span', `dmg${big ? ' big' : ''}`)
  d.append(pline(String(n)))
  target.node.append(d)
  await float(d, [0, -1, -2, -3, -3, -3].map(y => `translate(-50%,${y * ap()}px)`), 100, [1, 1, 1, 0.8, 0.5, 0.2])
}

async function callout(host: HTMLElement, text: string) {
  const c = el('span', 'callout', text)
  host.append(c)
  await wait(700)
  c.remove()
}

async function run() {
  if (!demo || !screen || !W || running) return
  running = true
  started = true
  perfects = 0
  if (next) { arena = next; next = null; paintArena(arena, true) }
  // the Start or Battle again button just pressed is about to go: the 1 key, the press that matters
  // during a battle, takes the focus
  if ($('.outrow')?.contains(D.activeElement)) $<HTMLElement>('[data-key1]')?.focus({ preventScroll: true })
  $('[data-start]')!.hidden = true
  const result = $('[data-result]')!
  result.hidden = true
  result.replaceChildren()
  $('[data-pcount]')!.textContent = ''
  const need = $('[data-need]')
  if (need) need.hidden = T.met
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16)).join('')
  const rng = rngFromSeed('site-battle/' + seed)
  const mine = team()
  let setup: BattleSetup = { seed, kind: 'wild', arena, rule: W.rule, rules: RULES_VERSION, attacker: mine, defender: [wildCard(W, rng)] }
  const inputs: number[] = []
  let log: BattleLog = simulateBattle(setup, inputs)
  // the dev preview can force a win (QA: a win evolves the creature and plays the catch)
  if (W.preview?.win === '1') for (let i = 0; i < 60 && log.result !== 'win'; i++) { setup = { ...setup, seed: `${seed}-${i}`, defender: [wildCard(W, rng)] }; log = simulateBattle(setup, inputs) }
  const wild = setup.defender[0] as SiteCard

  // the band's cast
  const band = $('[data-band]')!
  const sa = $('[data-side="a"]')!, sd = $('[data-side="d"]')!
  const A = mine.map(c => fighterNode(c)), Dd = [fighterNode(wild, true)]
  A.forEach((f, i) => { f.max = log.maxHp.a[i]!; setHp(f, f.max) })
  Dd.forEach((f, i) => { f.max = log.maxHp.d[i]!; setHp(f, f.max) })
  sa.replaceChildren(...(T.met ? [] : [ghost()]), ...A.map(f => f.node).reverse())
  sd.replaceChildren(...Dd.map(f => f.node))
  clearBanner()
  scan(band)
  A[0]?.node.classList.add('act')

  // Claude's turn, time-lapsed: the transcript fills in while the spinner's clock runs ahead to 20 s
  const spin = $('.spinner:not(.still)')!
  const secs = spin.querySelector('.secs')!
  screen.classList.remove('open')
  const lines = $$('.tx p')
  demo.classList.add('typed')
  if (RM()) secs.textContent = '20s'
  else {
    spin.classList.add('go', 'ffwd')
    lines.forEach(l => { l.style.visibility = 'hidden' })
    for (let s = 0; s <= 20; s++) {
      secs.textContent = `${s}s`
      for (let k = 0; k < lines.length; k++) if (k <= (s / 20) * (lines.length - 1)) lines[k]!.style.visibility = ''
      await wait(80)
    }
    spin.classList.remove('ffwd')
  }
  lines.forEach(l => { l.style.visibility = '' })
  screen.classList.add('open')
  await wait(360)

  // the rustle, the stillness, the flash, the reveal
  void banner('Something is rustling…', 0, false, 'Rustling…')
  say('Something is rustling…')
  for (let k = 0; k < 5; k++) { void wobble(Dd[0]!.svg); await wait(300) }
  await wait(300)
  await flash(Dd[0]!.svg)
  Dd[0]!.svg.classList.remove('sil')
  Dd[0]!.node.classList.add('act')
  void banner(`A wild ${cardName(wild)} appeared!`, 0, false, `${cardName(wild)} appeared!`)
  say(`A wild ${cardName(wild)} appeared!`)
  A.forEach((f, i) => setTimeout(() => void hop(f.svg), i * 100))
  await wait(700)

  let activeA = 0
  for (let r = 1; r <= log.rounds.length; r++) {
    const P = pace()
    let round = log.rounds[r - 1]!
    const t0 = performance.now()
    for (let i = 0; i < round.actions.length; i++) {
      const left = t0 + (i * P) / 2 - performance.now()
      if (left > 0) await wait(left)
      let action = round.actions[i]!
      let perfect = false
      if (action.side === 'a' && action.move === 'special') {
        perfect = await windup(P)
        if (perfect) {
          inputs.push(r)
          log = simulateBattle(setup, inputs)
          round = log.rounds[r - 1]!
          action = round.actions[i]!
          perfects++
          $('[data-pcount]')!.textContent = `Perfect x${perfects}`
        }
      }
      await play(action, action.side === 'a' ? A : Dd, action.side === 'a' ? Dd : A, perfect)
    }
    const rest = t0 + P - performance.now()
    if (rest > 0) await wait(rest)
    // end of round: regrowth and the like, then whoever is up next
    round.hp.a.forEach((hp, i) => setHp(A[i]!, hp))
    round.hp.d.forEach((hp, i) => setHp(Dd[i]!, hp))
    if (round.active.a !== activeA && round.active.a >= 0) {
      A[activeA]?.node.classList.remove('act')
      activeA = round.active.a
      A[activeA]!.node.classList.add('act')
      void steps(A[activeA]!.svg, [`translateX(${-2 * ap()}px)`, `translateX(${-ap()}px)`], 100)
    }
  }
  await finish(log, A, Dd[0]!)
}

/** The wind-up: 0.4 x pace with [1] Now! in gold and the keycap's ring lighting up. Resolves true on a press. */
async function windup(P: number): Promise<boolean> {
  const ms = 0.4 * P
  const key = $('[data-key1]')!
  const segs = $$<SVGPathElement>('.ring .sg', key)
  key.classList.add('now')
  void banner('[1] Now!', 0, true)
  let pressed = false
  await new Promise<void>(res => {
    windowOpen = () => { pressed = true; res() }
    segs.forEach((s, i) => setTimeout(() => s.classList.add('lit'), (i * ms) / segs.length))
    setTimeout(res, ms)
  })
  windowOpen = null
  key.classList.remove('now')
  segs.forEach(s => s.classList.remove('lit'))
  clearBanner()
  return pressed
}

async function play(a: BattleAction, mine: Fighter[], theirs: Fighter[], perfect: boolean) {
  const actor = mine[a.slot]!, target = theirs[a.targetSlot]!
  const amt = 2 * ap() * (actor.node.closest('.sa') ? 1 : -1)
  if (a.move === 'special' && a.special) {
    const move = SPECIALS[a.special].name, line = `${cardName(actor.card)} used ${move}!`
    void banner(line, 900, false, `${move}!`)
    if (a.side === 'a') say(line)
  }
  void steps(actor.svg, [`translateX(${amt}px)`, `translateX(${amt}px)`, 'translateX(0)'], 100)
  await wait(200)
  if (perfect) {
    void shake($('[data-band]'))
    void banner('Perfect!', 700, true)
    say('Perfect!')
  }
  await flash(target.svg)
  void popNumber(target, a.dmg, perfect)
  setHp(target, target.hp - a.dmg)
  if (a.heal) setHp(actor, actor.hp + a.heal)
  const notes = [a.effect === 'super' ? 'Super effective!' : a.effect === 'weak' ? 'Not very effective…' : '', a.crit ? 'Critical!' : '', ...a.traits.map(t => `${TRAITS[t]?.name ?? t}!`)].filter(Boolean)
  if (notes.length) void callout(target.node, notes.join(' '))
  if (a.targetFainted) {
    say(`${cardName(target.card)} is out.`)
    await steps(target.svg, ['none', 'none', 'none', 'none'], 80, { opacity: [0, 1, 0, 1] })
    await steps(target.svg, [`translateY(${2 * ap()}px)`, `translateY(${4 * ap()}px)`], 80, { opacity: [0.6, 0.2] })
    target.node.classList.add('out')
    target.node.classList.remove('act')
  }
}

/**
 * The catch roll after a win (SPEC 5, 13.4): the first win always catches, later ones 60% (80% on
 * Wild Bloom). The wild one spins into a card back that wobbles a beat per rarity step; then the card
 * turns over big and flies down to the result row, or the back unspins and the creature slips away.
 */
async function catchBeat(f: Fighter): Promise<boolean> {
  const c = f.card, a = ap()
  const chance = W!.rule === 'wildBloom' ? ECONOMY.battle.wildBloomCatchChance : ECONOMY.battle.catchChance
  const caught = wins++ === 0 || crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32 < chance
  f.node.classList.remove('out')
  await steps(f.svg, ['scaleX(.75)', 'scaleX(.5)', 'scaleX(.25)', 'scaleX(0)'], 70)
  f.svg.style.visibility = 'hidden'
  const back = el('i', 'bcard')
  back.style.setProperty('--glow', RARITY_COLOR[c.rarity])
  f.node.append(back)
  await wobble(back, c.rarity === 'common' ? 1 : c.rarity === 'rare' ? 2 : 3)
  await wait(300)
  if (caught) {
    clearBanner()
    await catchCard(c, back, { to: () => $('.outrow') })
    // it went into the card: its place in the band stays empty
    back.remove()
    f.node.querySelector('.hp')!.setAttribute('style', 'visibility:hidden')
    hooks.caught(c)
    return true
  }
  back.remove()
  f.svg.style.visibility = ''
  await steps(f.svg, ['scaleX(.25)', 'scaleX(.5)', 'scaleX(1)'], 70)
  void banner('It slipped away!')
  say('It slipped away!')
  await steps(f.svg, [`translate(${2 * a}px,${-3 * a}px)`, `translate(${4 * a}px,0)`, `translate(${8 * a}px,${-2 * a}px)`, `translate(${12 * a}px,${2 * a}px)`], 90, { opacity: [1, 1, 0.6, 0] })
  f.svg.style.visibility = 'hidden'
  return false
}

async function finish(log: BattleLog, A: Fighter[], wild: Fighter) {
  const result = $('[data-result]')!
  const part = participants(log, 'a')
  const xp = ECONOMY.battle.xp[log.result]
  const sparks = `+${ECONOMY.battle.sparks[log.result]} sparks.`
  const name = cardName(wild.card)
  const lines = el('div', 'lines')
  for (const i of part) {
    const f = A[i]
    if (!f || f.node.classList.contains('out')) continue
    const x = el('span', 'dmg')
    x.append(pline(`+${xp} XP`))
    f.node.append(x)
    void float(x, [0, -2, -4, -4, -4, -4, -4, -4].map(y => `translate(-50%,${y}px)`), 150, [1, 1, 1, 1, 1, .8, .5, .2])
  }
  if (log.result === 'win') {
    await banner('You won!', 1200)
    say('You won!')
    if (await catchBeat(wild)) {
      const row = el('p', 'big caught')
      row.append(sprite(wild.card), `Caught ${name}!`)
      const den = el('a', '', 'in the den below')
      den.href = '#collect'
      const soft = el('p', 'soft', `${sparks} It's waiting `)
      soft.append(den, '.')
      lines.append(row, soft)
      void banner(`${name} is yours!`, 0, false, 'Gotcha!')
    } else lines.append(el('p', 'big', 'It slipped away.'), el('p', 'soft', `${sparks} Win again and the next one might stay.`))
  } else if (log.result === 'loss') {
    void banner('It wandered off.')
    say(`${name} wandered back into the grass.`)
    wild.node.classList.remove('out')
    void steps(wild.svg, [1, 2, 3, 4].map(k => `translateY(${k * 2 * ap()}px)`), 100, { opacity: [1, 0.8, 0.4, 0] }).then(() => { wild.svg.style.visibility = 'hidden' })
    lines.append(el('p', 'big', `${name} wandered back into the grass.`), el('p', 'soft', `${sparks} You never lose a card.`))
  } else {
    void banner("It's a draw.")
    say("It's a draw.")
    lines.append(el('p', 'big', "It's a draw."), el('p', 'soft', sparks))
  }
  const again = el('button', 'pbtn')
  again.type = 'button'
  again.setAttribute('aria-keyshortcuts', '1')
  const faceEl = el('span', 'face', 'Battle again ')
  faceEl.append(el('span', 'kc1', '1'))
  again.append(faceEl)
  again.addEventListener('click', () => void run())
  result.replaceChildren(again, lines)
  result.hidden = false
  // a keyboard player pressing 1 along with the battle: what to press next is Battle again
  if (D.activeElement === $('[data-key1]')) again.focus({ preventScroll: true })
  if (T.met && T.lead && part.includes(0)) {
    const { card, evolved } = growth(xp)
    const lead = cardName(T.lead)
    if (evolved) {
      await evolve(A[0]!, card)
      commit(card)
      lines.append(el('p', 'soft', `${lead} evolved into ${cardName(card)}!`))
    } else {
      commit(card)
      const k = card.stage < 3 ? xpToGo(card) : 0
      lines.append(el('p', 'soft', `${lead} gained ${xp} XP.${k ? ` ${k} more to evolve.` : ''}`))
    }
  }
  running = false
  $('.spinner:not(.still)')?.classList.remove('go')
  if (next) caption()
}

/** XP still needed to reach the next evolution level. */
function xpToGo(c: SiteCard): number {
  const at = c.stage === 1 ? 4 : 8
  let need = xpToNext(c.level) - c.xp
  for (let l = c.level + 1; l < at; l++) need += xpToNext(l)
  return need
}

/** The evolution: 3 s of flicker between the sprite and the next stage's white silhouette, a flash, the reveal. */
async function evolve(f: Fighter, card: SiteCard) {
  const name = cardName(f.card)
  f.node.classList.remove('out')
  f.svg.style.opacity = ''
  void banner(`What? ${name} is evolving!`, 0, false, `${name} is evolving!`)
  say(`What? ${name} is evolving!`)
  const nextSvg = sprite(card, 'flash')
  nextSvg.style.position = 'absolute'
  nextSvg.style.bottom = '0'
  f.node.append(nextSvg)
  nextSvg.style.visibility = 'hidden'
  if (!RM()) {
    const gaps = [400, 300, 220, 160, 120, 90, 70, 60]
    let t = 0, on = false
    while (t < 3000) {
      const g = gaps.shift() ?? 50
      on = !on
      f.svg.style.visibility = on ? 'hidden' : ''
      nextSvg.style.visibility = on ? '' : 'hidden'
      await wait(g)
      t += g
    }
  }
  nextSvg.remove()
  const fresh = sprite(card)
  f.svg.replaceWith(fresh)
  f.svg = fresh
  f.node.querySelector('.nm')!.textContent = cardName(card)
  await flash(fresh)
  scan(f.node)
  await banner(`${name} evolved into ${cardName(card)}!`, 0, false, `Now ${cardName(card)}!`)
  say(`${name} evolved into ${cardName(card)}!`)
  await wait(2000)
}

/** The type wheel turns a quarter in 4 frames and the runners chase round. */
function wheel() {
  const w = $<HTMLButtonElement>('.wheel')
  if (!w) return
  let k = 0
  w.addEventListener('click', () => {
    k++
    w.classList.toggle('turning', !RM())
    for (const r of $$('.runner', w)) r.style.setProperty('--k', String(k))
  })
}

export function startBattle() {
  if (!demo || !W) return
  arena = hourFamily()
  paintArena(arena, false)
  controls()
  wheel()
  const start = $('[data-start]')
  if (start) start.hidden = false
  const need = $('[data-need]')
  if (need) need.hidden = T.met
  $('[data-needgo]')?.addEventListener('click', () => {
    $('#meet')?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'start' })
    setTimeout(() => $<HTMLButtonElement>('.you')?.focus({ preventScroll: true }), RM() ? 0 : 600)
  })
  onTeam(() => { if (need && !running) need.hidden = T.met; if (!running && !started) { arena = hourFamily(); paintArena(arena, false) } })
  keys.on('battle', { '1': press })
  // it starts by itself once, when the frame is a third in view; under reduced motion nothing runs
  // unasked, so Start battle waits for a press
  if (!RM()) new IntersectionObserver((es, io) => {
    if (es.some(e => e.isIntersecting) && !started) { io.disconnect(); void run() }
  }, { threshold: 0.35 }).observe(demo)
  D.addEventListener('visibilitychange', () => {
    if (D.hidden || !running) return
    for (const s of $$<SVGSVGElement>('.side.sa svg.spr')) lookAt(s, { x: s.getBoundingClientRect().left + 24, y: -500 }, 900)
  })
}

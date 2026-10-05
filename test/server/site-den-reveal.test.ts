import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import vm from 'node:vm'

// Run the actual pack ceremony and its keyboard registration with controlled DOM animations and timers.
// The unrelated nest/album animation is excluded, as in the public profile listener's VM fixture.
const source = readFileSync(new URL('../../server/static/client/den.ts', import.meta.url), 'utf8')
const keysAt = source.indexOf("keys.on('collect', {")
const ceremony = stripTypeScriptTypes(source.slice(source.indexOf('const shelf ='), source.indexOf('// ---- the nest'))
  + source.slice(keysAt, source.indexOf('\n  album()', keysAt))
  + '\nglobalThis.demo = { openPack, isOpening: () => opening };')

function den(cards = [{ id: 'first', rarity: 'common' }, { id: 'second', rarity: 'rare' }]) {
  type Pending = { node: Node; finish: () => void }
  const pending: Pending[] = [], timers = new Map<number, () => unknown>()
  let sequence = 0, focused: Node | null = null
  class Node {
    dataset: Record<string, string> = {}
    children: (Node | string)[] = []
    attributes: Record<string, string> = {}
    listeners = new Map<string, () => unknown>()
    hidden = true
    textContent = ''
    replacements = 0
    style = { setProperty: () => {} }
    classList = { add: () => {}, remove: () => {} }
    readonly kind: string
    readonly className: string
    constructor(kind = '', className = '') { this.kind = kind; this.className = className }
    get firstElementChild(): Node | undefined { return this.children.find((c): c is Node => c instanceof Node) }
    append(...children: (Node | string)[]) { this.children.push(...children) }
    replaceChildren(...children: (Node | string)[]) { this.children = children; this.replacements++ }
    setAttribute(name: string, value: string) { this.attributes[name] = value }
    removeAttribute(name: string) { delete this.attributes[name] }
    addEventListener(name: string, fn: () => unknown) { this.listeners.set(name, fn) }
    contains(node: Node | null): boolean { return node === this || this.children.some(c => c instanceof Node && c.contains(node)) }
    matches() { return false }
    focus() { focused = this }
    querySelector(selector: string) { return this.children.find(c => c instanceof Node && (selector === '.cf-name' ? c.className === 'cf-name' : c.kind === 'svg')) as Node | undefined }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 150 } }
    animate() {
      // The tear and flight are unrelated to the cursor; hold both halves of each actual card flip.
      const finished = this.className.startsWith('back ') || this.kind === 'face'
        ? new Promise<void>(finish => pending.push({ node: this, finish })) : Promise.resolve()
      return { finished }
    }
    remove() {}
  }
  const fan = new Node('ol'), pack = new Node('pack'), summary = new Node('summary'), hint = new Node('hint'), open = new Node('open')
  const shelf = new Node('shelf'), document = { get activeElement() { return focused } }
  const faces = new Map<string, Node>()
  const shortcuts: Record<string, () => unknown> = {}
  const select = (selector: string) => ({ '[data-shelf]': shelf, '[data-pack]': pack, '[data-fan]': fan,
    '[data-summary]': summary, '[data-fhint]': hint, '[data-open] .face': open })[selector]
  const items = () => fan.children.filter((c): c is Node => c instanceof Node)
  const all = (selector: string) => items().filter(li => selector.includes('[data-revealed]') ? !!li.dataset.revealed
    : selector.includes('[data-open]') ? !!li.dataset.open : true)
  const sandbox = {
    $: select, $$: all, D: document, RM: () => false, W: {}, hourFamily: () => 'opus',
    keys: { on: (_: string, handlers: Record<string, () => unknown>) => Object.assign(shortcuts, handlers) },
    crypto: { getRandomValues: (values: Uint8Array) => values.fill(1) }, rngFromSeed: () => () => 0,
    rollPack: () => cards.map(card => ({ card })),
    el: (kind: string, cls = '', text = '') => { const node = new Node(kind, cls); node.textContent = text; return node },
    face: (card: { id: string }) => { const node = new Node('face'); node.append(new Node('svg'), new Node('name', 'cf-name')); faces.set(card.id, node); return node },
    cardName: (card: { id: string }) => card.id, spoken: (card: { id: string }) => card.id,
    hideLayers: () => [], layered: async () => {}, flash: async () => {}, steps: async () => {}, scan: () => {}, say: () => {},
    settle: (animation: { finished: Promise<void> }) => animation.finished,
    fusing: false, dragStart: () => {},
    window: { setTimeout: (fn: () => unknown) => { const id = ++sequence; timers.set(id, fn); return id } },
    clearTimeout: (id: number) => timers.delete(id),
    demo: undefined as undefined | { openPack: () => Promise<void>; isOpening: () => boolean },
  }
  vm.runInNewContext(ceremony, sandbox)
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
  const finish = async (node: Node | undefined) => {
    const at = pending.findIndex(p => p.node === node)
    assert.ok(at >= 0, 'the requested flip half is waiting')
    pending.splice(at, 1)[0]!.finish()
    await flush()
  }
  return {
    async open() { await sandbox.demo!.openPack() },
    async click(i: number) { const back = items()[i]!.firstElementChild!; back.focus(); back.listeners.get('click')?.(); await flush() },
    async repeat(i: number) { items()[i]!.firstElementChild!.listeners.get('click')?.(); await flush() },
    async f() { shortcuts.f!(); await flush() },
    async auto() { const entry = timers.entries().next().value; assert.ok(entry); timers.delete(entry[0]); const work = entry[1](); await flush(); return { work } },
    back: (i: number) => items()[i]!.firstElementChild,
    finish, finishFace: (id: string) => finish(faces.get(id)),
    summary, items, pending, timers, faces,
    opening: () => sandbox.demo!.isOpening(), focus: () => focused,
  }
}

describe('the den pack reveal', () => {
  it('a single common card completes after its front settles, preserves focus and resets for another pack', async () => {
    const view = den([{ id: 'first', rarity: 'common' }])
    await view.open()
    assert.equal(view.items().length, 1)
    assert.equal(view.back(0)!.attributes['aria-label'], 'Card 1 of 1, face down')
    const back = view.back(0)
    await view.click(0)
    await view.repeat(0)
    assert.equal(view.pending.length, 1)
    await view.finish(back)
    assert.ok(view.summary.hidden, 'the card front is still turning')
    await view.finishFace('first')
    assert.equal(view.summary.hidden, false)
    assert.equal(view.summary.firstElementChild!.textContent, '1 card: common.')
    assert.equal(view.opening(), false)
    assert.equal(view.timers.size, 0)
    assert.equal(view.focus(), view.faces.get('first'))
    await view.open()
    assert.ok(view.summary.hidden)
    assert.equal(view.items().length, 1)
    assert.ok(!view.items()[0]!.dataset.open && !view.items()[0]!.dataset.revealed)
  })

  it('a second-back-first click followed by f completes both cards only after all in-flight flips settle', async () => {
    const view = den()
    await view.open()
    assert.equal(view.back(1)!.attributes['aria-label'], 'Card 2 of 2, face down, glowing blue')
    const first = view.back(0), second = view.back(1)
    await view.click(1)
    await view.f()
    assert.equal(view.pending.length, 2)
    assert.ok(view.summary.hidden)
    await view.finish(first)
    await view.finishFace('first')
    assert.ok(view.summary.hidden, 'the second card is still turning')
    assert.ok(view.opening())
    await view.finish(second)
    assert.ok(view.summary.hidden, 'the second card front has not finished turning')
    await view.finishFace('second')
    assert.equal(view.summary.hidden, false)
    assert.equal(view.opening(), false)
    assert.match(view.summary.firstElementChild!.textContent, /^2 cards: 1 rare\. 2 different creatures\./)
    assert.equal(view.summary.replacements, 1)
    assert.equal(view.focus(), view.faces.get('second'), 'the clicked back hands focus to its revealed card')
  })

  it('auto-flip finds the first back after the second was manually revealed and leaves no pending timer', async () => {
    const view = den()
    await view.open()
    const first = view.back(0), second = view.back(1)
    await view.click(1)
    await view.finish(second)
    await view.finishFace('second')
    assert.ok(view.summary.hidden)
    const { work } = await view.auto()
    await view.finish(first)
    await view.finishFace('first')
    await work
    assert.equal(view.summary.hidden, false)
    assert.equal(view.opening(), false)
    assert.equal(view.timers.size, 0)
    assert.equal(view.focus(), view.faces.get('second'), 'auto-flip does not move focus away from the chosen card')
  })

  it('sequential and repeated back clicks reveal each card once, and a fresh pack resets completion', async () => {
    const view = den()
    await view.open()
    const first = view.back(0), second = view.back(1)
    await view.click(0)
    await view.repeat(0)
    assert.equal(view.pending.length, 1, 'repeated clicks do not start another flip')
    await view.finish(first)
    await view.finishFace('first')
    assert.ok(view.summary.hidden)
    await view.f()
    await view.repeat(1)
    assert.equal(view.pending.length, 1)
    await view.finish(second)
    await view.finishFace('second')
    await view.f()
    assert.equal(view.pending.length, 0)
    assert.equal(view.summary.replacements, 1)
    await view.open()
    assert.ok(view.summary.hidden)
    assert.ok(view.items().every(li => !li.dataset.open && !li.dataset.revealed))
    await view.f()
    assert.equal(view.pending.length, 1, 'the new pack starts with its own first back')
  })
})

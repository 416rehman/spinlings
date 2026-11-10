// Opening every waiting pack at once (SPEC 13.5), through the wired mod: ten to an openPacks request where the server
// lists open-many, one openPack at a time where it does not, a refusal keeps what opened, the best pulls play and Skip
// goes to the summary, motion off goes there at once, and the band's pack-ready moment opens them all in the pane.
// A pack opened elsewhere meanwhile drops out and the rest go once more (esc while they open: test/client/open-all-stop.test.ts).
// The summary stacks identical pulls and puts Done above the cards.
// Every phase is drawn on the terminal and the desktop at narrow and wide sizes without overflow.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { PackView } from '../../plugin/hooks/core/api.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import { rarityGroups } from '../../plugin/hooks/client/bulk.ts'
import type { GameState } from '../../plugin/hooks/client/types.ts'
import { BAND, PANE, RUN, SESSION, engine, measure, settle, textOf, walk } from './engine.ts'
import type { Request } from './engine.ts'
import { NOW, fakeServer } from './fixtures.ts'
import type { FakeServer } from './fixtures.ts'

const LONG = { timeoutMs: 180_000 }
const FAMILIES = ['opus', 'haiku', 'fable', 'sonnet'] as const

function probe(on: On) {
  const p = { state: JSON.parse(JSON.stringify(INITIAL)) as GameState, version: 0 }
  on('state.get', (_$, e) => ({ value: { value: p.state[e.key as keyof GameState], version: p.version } }))
  on('state.set', (_$, e) => {
    Object.assign(p.state, { [e.key]: e.value })
    return { value: { isSet: true, version: ++p.version } }
  })
  return p
}

/** A server whose player has `n` packs waiting; `many` false answers version without open-many. */
function bank(n: number, o: { many?: boolean; refuseAfter?: number } = {}): FakeServer {
  // an easy join keeps these sessions light beside the rest of the suite
  const server = fakeServer({ difficulty: 1 })
  const packs: PackView[] = Array.from({ length: n }, (_, i) => ({ id: `bank-${i}`, family: FAMILIES[i % 4]!, source: 'charge', day: utcDay(NOW) }))
  server.me = { ...server.me, packs, player: { ...server.me.player, battles: 4 } }
  const handle = server.handle
  let openCalls = 0
  server.handle = (url, init) => {
    if (url.endsWith('/v1/packs/open-many') || url.endsWith('/v1/packs/open')) {
      if (o.refuseAfter !== undefined && openCalls++ >= o.refuseAfter) {
        server.calls.push({ method: 'POST', path: '/refused', headers: {}, body: '' })
        return { status: 429, ok: false, headers: { 'content-type': 'application/json', 'retry-after': '30' }, text: JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down' } }) }
      }
    }
    const answer = handle(url, init)
    if (url.endsWith('/v1/version') && o.many === false) {
      const v = JSON.parse(answer.text) as { features: string[] }
      return { ...answer, text: JSON.stringify({ ...v, features: v.features.filter(f => f !== 'open-many') }) }
    }
    return answer
  }
  return server
}

const opens = (requests: Request[], path: string) => requests.filter(r => r.url.endsWith(path))

function fits(tree: unknown, columns: number, where: string): void {
  const problems: string[] = []
  const size = measure(tree, columns, problems)
  if (size.w > columns) problems.push(`needs ${size.w} cells`)
  const keys = walk(tree).filter(n => n.type === 'Button').map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dupes.length) problems.push(`keys twice: ${dupes.join(' ')}`)
  expect({ where, problems }).toEqual({ where, problems: [] })
}

async function drawAll($: { ui: { mount(e: never): Promise<{ drawn(): Promise<unknown>; unmount(): Promise<void> }> } }, where: string): Promise<string[]> {
  const texts: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) for (const columns of [32, 80]) {
    const ui = await $.ui.mount(PANE(columns, surface) as never)
    const tree = await ui.drawn()
    fits(tree, columns, `${where} @${columns} ${surface}`)
    texts.push(textOf(tree))
    await ui.unmount()
  }
  return texts
}

test('Open all opens 23 packs in three openPacks requests, plays the best pulls, and Skip shows every card by rarity', LONG, async ($, on) => {
  const server = bank(23)
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  expect(p.state.account.features).toContain('open-many')
  const before = p.state.cards.length
  let ui = await $.ui.mount(PANE(80, 'terminal'))
  expect((await ui.find({ key: 'open-all' }))?.props).toMatchObject({ label: 'Open all (23)', hotkey: 'o', variant: 'primary' })
  await ui.press({ key: 'open-all' })
  await settle(clock)
  const many = opens(w.requests, '/v1/packs/open-many')
  expect(many.map(r => (JSON.parse(r.body) as { packIds: string[] }).packIds.length)).toEqual([10, 10, 3])
  expect(many.flatMap(r => (JSON.parse(r.body) as { packIds: string[] }).packIds)).toEqual(Array.from({ length: 23 }, (_, i) => `bank-${i}`))
  expect(opens(w.requests, '/v1/packs/open')).toEqual([])
  const r = p.state.reveal!
  expect(r.bulk).toMatchObject({ packs: 23, opened: 23 })
  expect(r.cards).toHaveLength(23)
  expect(r.bulk!.best).toBeGreaterThan(0)
  expect(r.bulk!.best!).toBeLessThanOrEqual(5)
  expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'reveal' })
  expect(p.state.me!.packs).toEqual([])
  expect(p.state.cards.length).toBe(before + 23)
  // the best pulls come first, one at a time, each with its beat
  await ui.redraw()
  expect((await ui.find({ key: 'skip' }))?.props).toMatchObject({ label: 'Skip to all', hotkey: 's' })
  await ui.unmount()
  await drawAll($ as never, 'best pulls')
  ui = await $.ui.mount(PANE(80, 'terminal'))
  await ui.press({ key: 'skip' })
  await settle(clock)
  await ui.redraw()
  expect(p.state.pane.flipped).toBe(23)
  // the summary: every card grouped by rarity, with counts that add up, and each card opens its page
  const text = textOf(await ui.drawn())
  expect(text).toMatch(/^.*23 packs · 23 cards/m)
  const counts = [...text.matchAll(/(Mythic|Legendary|Epic|Rare|Common) · (\d+)/g)].map(m => Number(m[2]))
  expect(counts.reduce((a, b) => a + b, 0)).toBe(23)
  // what to do next sits right under the summary line, above the cards
  expect(text.indexOf('Done')).toBeGreaterThan(-1)
  expect(text.indexOf('Done')).toBeLessThan(text.search(/(Mythic|Legendary|Epic|Rare|Common) · \d+/))
  // one chip per stack of identical pulls
  const fresh = new Set(r.fresh)
  const stacks = rarityGroups(r.cards, fresh).flatMap(g => g.stacks)
  const chips = walk(await ui.drawn()).filter(n => n.type === 'Button' && /^sum-.+-pick$/.test(String(n.key ?? n.props?.key)))
  expect(chips.length).toBe(stacks.length)
  await ui.unmount()
  await drawAll($ as never, 'summary')
  ui = await $.ui.mount(PANE(80, 'terminal'))
  const first = stacks[0]!.card
  await ui.press({ key: `sum-${first.id}-pick` })
  await settle(clock)
  expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'card', cardId: first.id })
  await ui.press({ key: 'pane-back' })
  await settle(clock)
  await ui.redraw()
  expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'reveal' })
  if (r.fresh.length > 0) {
    await ui.press({ key: 'new-only' })
    await settle(clock)
    await ui.redraw()
    expect(p.state.reveal!.bulk!.newOnly).toBe(true)
    const shown = walk(await ui.drawn()).filter(n => n.type === 'Button' && /^sum-.+-pick$/.test(String(n.key ?? n.props?.key)))
    expect(shown.length).toBe(rarityGroups(r.cards.filter(c => fresh.has(c.species)), fresh).flatMap(g => g.stacks).length)
    await ui.unmount()
    await drawAll($ as never, 'new only')
    ui = await $.ui.mount(PANE(80, 'terminal'))
  }
  await ui.press({ key: 'done' })
  await settle(clock)
  expect(p.state.reveal).toBeNull()
  expect(p.state.pane.stack.filter(v => v.kind === 'reveal')).toEqual([])
  await ui.unmount()
})

test('a server without open-many gets one openPack per pack, and motion off goes straight to the summary', LONG, async ($, on) => {
  const server = bank(12, { many: false })
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('motion off'))
  await settle(clock)
  expect(p.state.account.features).not.toContain('open-many')
  const ui = await $.ui.mount(PANE(40, 'desktop'))
  await ui.press({ key: 'open-all' })
  await settle(clock, 12)
  expect(opens(w.requests, '/v1/packs/open-many')).toEqual([])
  expect(opens(w.requests, '/v1/packs/open').map(r => (JSON.parse(r.body) as { packId: string }).packId)).toEqual(Array.from({ length: 12 }, (_, i) => `bank-${i}`))
  expect(p.state.reveal!.bulk).toMatchObject({ packs: 12, opened: 12 })
  expect(p.state.pane.flipped).toBe(12)
  await ui.redraw()
  expect(await ui.find({ key: 'done' })).toBeDefined()
  expect(await ui.find({ key: 'skip' })).toBeUndefined()
  await ui.unmount()
})

test('a refusal part way keeps what opened, says how many still wait, and leaves them in the bank', LONG, async ($, on) => {
  const server = bank(25, { refuseAfter: 1 })
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  const ui = await $.ui.mount(PANE(80, 'terminal'))
  await ui.press({ key: 'open-all' })
  await settle(clock)
  expect(opens(w.requests, '/v1/packs/open-many')).toHaveLength(2)
  expect(p.state.reveal!.bulk).toMatchObject({ packs: 25, opened: 10 })
  expect(p.state.me!.packs.map(x => x.id)).toEqual(Array.from({ length: 15 }, (_, i) => `bank-${i + 10}`))
  // everything auto-advances: the best pulls play, then the summary
  for (let k = 0; k < 6; k++) { await clock.advance(10_000); await settle(clock) }
  expect(p.state.pane.flipped).toBe(10)
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/10 packs · 10 cards.*15 still waiting/)
  await ui.unmount()
})

test('while the packs open, the stack, the count and the bar draw whole at every size, and a turn runs meanwhile', LONG, async ($, on) => {
  const server = bank(30)
  let release: (() => void) | null = null
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, server, request => request.url.endsWith('/v1/packs/open-many') ? new Promise<void>(done => { release = done }) : undefined)
  const p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  const ui = await $.ui.mount(PANE(80, 'terminal'))
  const pressed = ui.press({ key: 'open-all' })
  await settle(clock)
  expect(p.state.reveal!.bulk).toMatchObject({ packs: 30, opened: 0 })
  await ui.unmount()
  // a turn runs while the first request is out
  await $.turn.start({ turnId: 't1', text: 'hello' } as never)
  const texts = await drawAll($ as never, 'opening')
  expect(texts.every(t => /Opening 30 packs/.test(t) && /30 to go/.test(t))).toBe(true)
  for (let k = 0; k < 3 && release; k++) {
    const go = release as () => void
    release = null
    go()
    await settle(clock)
  }
  await pressed
  expect(opens(w.requests, '/v1/packs/open-many')).toHaveLength(3)
  expect(p.state.reveal!.bulk).toMatchObject({ packs: 30, opened: 30 })
})

test('a pack opened elsewhere meanwhile drops out, and the rest of its ten go once more', LONG, async ($, on) => {
  const server = bank(12)
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  // another session opens bank-3 after this one last read the bank
  server.me = { ...server.me, packs: server.me.packs.filter(x => x.id !== 'bank-3') }
  expect(p.state.me!.packs).toHaveLength(12)
  const ui = await $.ui.mount(PANE(80, 'terminal'))
  await ui.press({ key: 'open-all' })
  await settle(clock)
  const many = opens(w.requests, '/v1/packs/open-many').map(r => (JSON.parse(r.body) as { packIds: string[] }).packIds)
  expect(many.map(ids => ids.length)).toEqual([10, 9, 2])
  expect(many[1]).not.toContain('bank-3')
  expect(p.state.reveal!.bulk).toMatchObject({ packs: 11, opened: 11 })
  expect(p.state.me!.packs).toEqual([])
  expect(p.state.pane.message).toBe('')
  for (let k = 0; k < 6; k++) { await clock.advance(10_000); await settle(clock) }
  await ui.redraw()
  const text = textOf(await ui.drawn())
  expect(text).toMatch(/11 packs · 11 cards/)
  expect(text).not.toMatch(/still waiting/)
  await ui.unmount()
})

test('the band\'s pack-ready moment opens them all in the pane on 1', LONG, async ($, on) => {
  const server = bank(14)
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  p.state.moments = [{ kind: 'pack-ready', id: 'pack-ready', count: 14, until: null }]
  for (const surface of ['terminal', 'desktop'] as const) for (const columns of [40, 80, 120]) {
    const band = await $.ui.mount(BAND(columns, surface))
    const tree = await band.drawn()
    fits(tree, columns, `pack-ready @${columns} ${surface}`)
    const buttons = walk(tree).filter(n => n.type === 'Button').map(b => [b.props?.hotkey, b.props?.label])
    expect(buttons.map(b => b[0])).toEqual(['1', '2', '3'])
    expect(String(buttons[0]![1])).toMatch(/^(Open all \(14\)|All 14)$/)
    await band.unmount()
  }
  const band = await $.ui.mount(BAND(80, 'terminal'))
  await band.press({ key: 'all-pack-ready' })
  await settle(clock)
  expect(w.opened).toBeGreaterThan(0)
  expect(opens(w.requests, '/v1/packs/open-many')).toHaveLength(2)
  expect(p.state.moments.some(m => m.kind === 'pack-ready')).toBe(false)
  expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'reveal' })
  expect(p.state.reveal!.inline).toBeFalsy()
  await band.unmount()
})

test('the band\'s pack-ready 2 still opens just one pack, sealed above the prompt, sending nothing yet', LONG, async ($, on) => {
  const server = bank(5)
  const clock = mock.clock(on, { now: NOW }), w = engine(on, server), p = probe(on)
  await $.session.start(SESSION)
  await settle(clock)
  p.state.moments = [{ kind: 'pack-ready', id: 'pack-ready', count: 5, until: null }]
  const band = await $.ui.mount(BAND(80, 'terminal'))
  await band.press({ key: 'act-pack-ready' })
  await settle(clock)
  expect(p.state.reveal).toMatchObject({ inline: true, cards: [] })
  expect(p.state.reveal!.bulk).toBeUndefined()
  expect(opens(w.requests, '/v1/packs/open-many')).toEqual([])
  expect(opens(w.requests, '/v1/packs/open')).toEqual([])
  await band.unmount()
})

// The real owning plugin loads the surface module: image/body clicks use the same action as the name Button.
import { expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import { uiScenes } from './ui-scenes.ts'
import type { El, GameState } from '../../plugin/hooks/client/types.ts'
import { card } from '../../plugin/hooks/ui/card.tsx'
import { PANE, engine, settle } from './engine.ts'

const NOW = Date.UTC(2026, 9, 2, 12)
const sample = (title: string) => JSON.parse(JSON.stringify(uiScenes(NOW).find(s => s.title === title)!.state)) as GameState

function stateProbe(on: On) {
  const probe = { state: sample('Team · slots, resting, notices with Revenge'), version: 0 }
  on('state.get', (_$, e) => ({ value: { value: probe.state[e.key as keyof GameState], version: probe.version } }))
  on('state.set', (_$, e) => {
    const key = e.key as keyof GameState
    Object.assign(probe.state, { [key]: e.value })
    return { value: { isSet: true, version: ++probe.version } }
  })
  return probe
}

async function click(ui: Mounted, key: string, x: number, y: number, columns = 18, rows = 14): Promise<void> {
  await ui.resize({ in: key, columns, rows })
  await ui.pointer({ in: key, type: 'down', x, y, button: 'left' })
  await ui.pointer({ in: key, type: 'up', x, y, button: 'left' })
  await ui.advance(16)
}

async function hitKey(ui: Mounted, button: string, part = 'art'): Promise<string> {
  const prefix = button.replace(/-pick$/, '') + `-${part}-`
  return (await ui.findAll({ type: 'Client' })).find(n => n.key?.startsWith(prefix) && n.key.endsWith('-hit'))!.key!
}

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
function nodes(tree: unknown, visit: (n: Node, parents: Node[]) => void, parents: Node[] = []): void {
  if (!tree || typeof tree !== 'object' || !('type' in tree)) return
  const node = tree as Node
  visit(node, parents)
  for (const child of node.children ?? []) nodes(child, visit, [...parents, node])
}

/** A Client covers only its immediate natural region, never a native Button or the caller's extra controls. */
function regionsLeaveButtonsExposed(tree: unknown): number {
  let count = 0
  nodes(tree, (node, parents) => {
    if (node.type !== 'Client') return
    count++
    const overlay = parents.at(-1)!
    const region = parents.at(-2)!
    expect(node.props).toMatchObject({ width: '100%', flexGrow: 1 })
    expect(node.props?.height).toBeUndefined()
    expect(region.props).toMatchObject({ position: 'relative', flexDirection: 'column', overflow: 'hidden' })
    const content = region.children![0] as Node
    const edge = content.type === 'Svg' ? -1 : 0
    expect(overlay.props).toMatchObject({ position: 'absolute', top: 0, bottom: edge, left: 0, right: edge, flexDirection: 'column' })
    if (content.type === 'Svg') expect((node.props?.props as { size: unknown }).size).toEqual({ pixels: { width: content.props!.width, height: content.props!.height } })
    const controls: string[] = []
    nodes(region, n => { if (['Button', 'Input', 'Select', 'Link'].includes(n.type)) controls.push(n.type) })
    expect(controls).toEqual([])
  })
  return count
}

/** Desktop Ds differs from the headless reader: SVG alt is trimmed and must be nonempty. */
function nativeSvgSupported(node: Node): boolean {
  const p = node.props ?? {}
  return node.type === 'Svg' && node.children === undefined
    && typeof p.source === 'string' && p.source.length > 0 && p.source.length <= 131072
    && typeof p.alt === 'string' && p.alt.trim().length > 0
    && ['width', 'height'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) > 0 && (p[k] as number) <= 4096)
    && (p.isInteractive === undefined || typeof p.isInteractive === 'boolean')
}

async function intrinsicExtent(ui: Mounted, key: string): Promise<void> {
  const size = ((await ui.find({ key }))!.props.props as { size: { pixels?: { width: number; height: number }; rows?: number } }).size
  if (size.pixels) {
    const spacers = await ui.findAll({ type: 'Svg', in: key })
    expect(spacers).toHaveLength(1)
    expect(spacers[0]!.props).toMatchObject({ ...size.pixels, alt: 'Select creature' })
    expect(nativeSvgSupported({ type: 'Svg', props: spacers[0]!.props })).toBe(true)
    for (const alt of ['', ' \n\t ']) expect(nativeSvgSupported({ type: 'Svg', props: { ...spacers[0]!.props, alt } })).toBe(false)
    expect(nativeSvgSupported({ type: 'Svg', props: spacers[0]!.props, children: [] })).toBe(false)
    // No painted shapes or duplicate art: the exact viewport plus one clipped Text line establishes the height.
    expect(spacers[0]!.props.source).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.pixels.width} ${size.pixels.height}"/>`)
    const padding = await ui.findAll({ type: 'Text', in: key })
    expect(padding).toHaveLength(1)
    expect(padding[0]!.text).toBe(' ')
  } else {
    const spacers = await ui.findAll({ type: 'Text', in: key })
    expect(spacers).toHaveLength(1)
    expect(spacers[0]!.text).toBe('\n'.repeat(size.rows! - 1) + ' ')
  }
}

test('desktop team and collection keep distinct artwork, family and rarity regions at 24 and 80 columns', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  for (const title of ['Team · slots, resting, notices with Revenge', 'Cards · the collection']) {
    for (const columns of [24, 80]) for (const part of ['art', 'family', 'rarity']) {
      const state = sample(title)
      probe.state = state
      const ui = await $.ui.mount(PANE(columns, 'desktop'))
      const buttons = await ui.findAll({ type: 'Button' })
      const button = buttons.find(b => title.startsWith('Team') ? b.key === 'team-0-pick' : /^card-.+-pick$/.test(b.key ?? ''))!
      expect(button).toBeDefined()
      const key = await hitKey(ui, button.key!, part)
      expect((await ui.find({ key }))?.props).toMatchObject({ width: '100%', flexGrow: 1 })
      expect(regionsLeaveButtonsExposed(await ui.drawn())).toBeGreaterThan(0)
      await intrinsicExtent(ui, key)
      if (part === 'art') expect(((await ui.find({ key }))!.props.props as { size: unknown }).size)
        .toEqual({ pixels: { width: columns === 24 ? 32 : 72, height: columns === 24 ? 32 : 72 } })
      expect(buttons.filter(b => b.key === button.key)).toHaveLength(1)
      await click(ui, key, 1, part === 'art' ? 1 : 0, 18, part === 'art' ? 10 : 1)
      await settle(clock)
      expect(probe.state.pane.stack).toHaveLength(1)
      expect(probe.state.pane.stack[0]?.kind).toBe('card')
      await ui.unmount()
    }
  }
})

test('clipped artwork padding covers partial right and bottom cells without relaxing captured-release bounds', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  for (const columns of [24, 80]) {
    probe.state = sample('Team · slots, resting, notices with Revenge')
    const id = probe.state.me!.player.team[0]
    const ui = await $.ui.mount(PANE(columns, 'desktop'))
    const key = await hitKey(ui, 'team-0-pick')
    const size = ((await ui.find({ key }))!.props.props as { size: { pixels: { width: number; height: number } } }).size.pixels
    await intrinsicExtent(ui, key)
    expect(regionsLeaveButtonsExposed(await ui.drawn())).toBeGreaterThan(0)
    // Native Gr measures ch/lh; se floors holder size, le floors pointer position. These varied units
    // exercise that contract, not a font conversion or a claim that headless resize proves DOM geometry.
    for (const [ch, lh] of [[7.5, 17], [11, 19], [9.25, 22.5]]) {
      const x = Math.floor((size.width - .01) / ch), y = Math.floor((size.height - .01) / lh)
      const measuredColumns = Math.floor((size.width + ch) / ch)
      const measuredRows = Math.floor((size.height + lh) / lh)
      expect(x).toBe(Math.floor(size.width / ch))
      expect(y).toBe(Math.floor(size.height / lh))
      expect(x).toBeLessThan(measuredColumns)
      expect(y).toBeLessThan(measuredRows)
    }
    const ch = 7.5, lh = 17
    const measuredColumns = Math.floor((size.width + ch) / ch), measuredRows = Math.floor((size.height + lh) / lh)
    const x = Math.floor((size.width - .01) / ch), y = Math.floor((size.height - .01) / lh)
    await ui.resize({ in: key, columns: measuredColumns, rows: measuredRows })
    await ui.pointer({ in: key, type: 'down', x, y, button: 'left' })
    await ui.pointer({ in: key, type: 'up', x: measuredColumns, y, button: 'left' })
    await ui.advance(16)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([])
    await ui.pointer({ in: key, type: 'down', x, y, button: 'left' })
    await ui.pointer({ in: key, type: 'up', x, y: measuredRows, button: 'left' })
    await ui.advance(16)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([])
    await click(ui, key, x, y, measuredColumns, measuredRows)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
    await ui.unmount()
  }
})

test('the first delivered artwork, family or rarity click works with genuinely unreported region dimensions', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  for (const part of ['art', 'family', 'rarity']) {
    probe.state = sample('Team · slots, resting, notices with Revenge')
    const id = probe.state.me!.player.team[0]
    // The headless adapter otherwise sizes every Client to the entire pane viewport, bypassing native geometry.
    const ui = await $.ui.mount({ ...PANE(24, 'desktop'), viewport: { columns: 0, rows: 0 } })
    const key = await hitKey(ui, 'team-0-pick', part)
    await intrinsicExtent(ui, key)
    const y = part === 'art' ? 3 : 0
    await ui.pointer({ in: key, type: 'down', x: 1, y, button: 'left' })
    await ui.pointer({ in: key, type: 'up', x: 1, y, button: 'left' })
    await ui.advance(16)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
    await ui.unmount()
  }
})

test('wrapping family and rarity rows retain their own multirow intrinsic region', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  for (const part of ['family', 'rarity']) {
    probe.state = sample('Team · slots, resting, notices with Revenge')
    const id = probe.state.me!.player.team[0]!
    const c = probe.state.cards.find(c => c.id === id)!
    Object.assign(c, { family: 'sonnet', level: 100, rarity: 'legendary', shiny: true, foil: true })
    const ui = await $.ui.mount({ ...PANE(24, 'desktop'), viewport: { columns: 0, rows: 0 } })
    const key = await hitKey(ui, 'team-0-pick', part)
    const rows = part === 'rarity' ? 3 : 2
    expect(((await ui.find({ key }))!.props.props as { size: unknown }).size).toEqual({ rows })
    await intrinsicExtent(ui, key)
    expect(regionsLeaveButtonsExposed(await ui.drawn())).toBeGreaterThan(0)
    // No resize act: the last wrapped row belongs to this passive line and remains a completed local selection.
    await ui.pointer({ in: key, type: 'down', x: 1, y: rows - 1, button: 'left' })
    await ui.pointer({ in: key, type: 'up', x: 1, y: rows - 1, button: 'left' })
    await ui.advance(16)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
    await ui.unmount()
  }
})

test('empty slots, packs and discoveries keep their native action Buttons outside all pointer regions', { timeoutMs: 60_000 }, async ($, on) => {
  engine(on)
  const probe = stateProbe(on)
  for (const title of ['Team · slots, resting, notices with Revenge', 'Album · Opus']) {
    for (const columns of [24, 80]) {
      probe.state = sample(title)
      if (title.startsWith('Team')) {
        probe.state.me!.player.team = probe.state.me!.player.team.slice(0, 1)
        probe.state.me!.packs = [{ id: 'test-pack', family: 'haiku', source: 'welcome', day: '2026-10-02' }]
      }
      const ui = await $.ui.mount(PANE(columns, 'desktop'))
      expect(regionsLeaveButtonsExposed(await ui.drawn())).toBeGreaterThan(0)
      const buttons = await ui.findAll({ type: 'Button' })
      expect({ title, columns, action: buttons.some(b => title.startsWith('Team') ? b.key === 'pack-test-pack' : b.key?.startsWith('album-') && b.key.endsWith('-pick')) }).toEqual({ title, columns, action: true })
      if (title.startsWith('Team')) expect(buttons.some(b => b.key === 'team-1-pick' && b.props.label === 'Pick a card')).toBe(true)
      await ui.unmount()
    }
  }
})

test('caller extra controls remain between metadata and note, outside the Client regions', { timeoutMs: 30_000 }, async ($, on) => {
  const c = sample('Team · slots, resting, notices with Revenge').cards[0]!
  let captured: unknown
  on('ui.render', { component: 'Pane', requestId: 'extra-probe' }, ($, e) => {
    const el = $.ui.resolve(e) as unknown as El
    captured = card(el, 'desktop', c, 'tile', {
      key: 'probe-card', hitArea: true, on: () => undefined, note: 'A note',
      extra: el.Button({ key: 'extra-control', label: 'Extra action', onPress: () => undefined }),
    })
    // This inline test does not own the mod's surface module. Inspect the component tree before mounting its Clients.
    return el.Text({ children: 'Extra control fixture' })
  })
  const ui = await $.ui.mount({ ...PANE(24, 'desktop'), requestId: 'extra-probe' })
  const tree = captured as Node
  expect(regionsLeaveButtonsExposed(tree)).toBe(4)
  const children = tree.children as Node[]
  const nativeButtons = children.filter(n => n.type === 'Button').map(n => n.props?.key)
  expect(nativeButtons).toEqual(['probe-card-pick', 'extra-control'])
  const extraAt = children.findIndex(n => n.type === 'Button' && n.props?.key === 'extra-control')
  expect(children[extraAt - 1]?.type).toBe('Box')
  expect(children[extraAt + 1]?.type).toBe('Box')
  await ui.unmount()
})

test('a wrapping name leaves its Button exposed and makes its passive overflow line pressable', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  const id = probe.state.me!.player.team[0]!
  const c = probe.state.cards.find(c => c.id === id)!
  c.species = 'fusion'
  c.form = { ...uiScenes(NOW).find(s => s.state.cards.some(c => c.form))!.state.cards.find(c => c.form)!.form!, kind: 'fusion', names: ['A Long Creature Name', 'A Long Creature Name', 'A Long Creature Name'] }
  const ui = await $.ui.mount(PANE(24, 'desktop'))
  expect(regionsLeaveButtonsExposed(await ui.drawn())).toBeGreaterThan(0)
  expect((await ui.find({ key: 'team-0-pick' }))?.props.label).toBe('A Long')
  const key = await hitKey(ui, 'team-0-pick', 'name')
  await click(ui, key, 1, 1, 14, 2)
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
  await ui.unmount()
})

test('mini partner art uses its existing selection once and keeps the numbered name Button', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  on('ui.focus', (_$, e) => ({ element: e.element }))
  probe.state = sample('Fuse · pick a partner')
  const ui = await $.ui.mount(PANE(24, 'desktop'))
  const button = (await ui.findAll({ type: 'Button' })).find(b => /^partner-.+-pick$/.test(b.key ?? ''))!
  expect(button.props.hotkey).toBe('1')
  const id = button.key!.replace(/^partner-/, '').replace(/-pick$/, '')
  await click(ui, await hitKey(ui, button.key!), 1, 1, 14, 8)
  await settle(clock)
  expect(probe.state.pane.stack).toHaveLength(1)
  expect(probe.state.pane.stack[0]).toMatchObject({ kind: 'fuse', otherId: id })
  await ui.unmount()
})

test('pointer down alone, right clicks, outside releases, drags and invalid messages do nothing', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  const ui = await $.ui.mount(PANE(80, 'desktop'))
  const key = await hitKey(ui, 'team-0-pick')
  await ui.resize({ in: key, columns: 18, rows: 14 })
  await ui.pointer({ in: key, type: 'down', x: 1, y: 1, button: 'left' })
  await ui.advance(16)
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([])
  for (const events of [
    [{ type: 'down', x: 1, y: 1, button: 'right' }, { type: 'up', x: 1, y: 1, button: 'right' }],
    [{ type: 'down', x: 1, y: 1, button: 'left' }, { type: 'up', x: 18, y: 1, button: 'left' }],
    [{ type: 'down', x: 1, y: 1, button: 'left' }, { type: 'move', x: 5, y: 1, button: 'left' }, { type: 'up', x: 1, y: 1, button: 'left' }],
  ] as const) {
    for (const event of events) await ui.pointer({ in: key, ...event })
    await ui.advance(16)
    await settle(clock)
    expect(probe.state.pane.stack).toEqual([])
  }
  await ui.post({ pick: 'team-0' }, { in: key })
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([])
  await ui.unmount()
})

test('a queued click is rejected after its team target changes or the pane switches to terminal rendering', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  // Close/focus races use the deterministic dispatcher tests: ui.press flushes queued work before pressing.
  for (const change of ['reuse', 'terminal']) {
    const state = sample('Team · slots, resting, notices with Revenge')
    probe.state = state
    const ui = await $.ui.mount(PANE(80, 'desktop'))
    await ui.post(null, { in: await hitKey(ui, 'team-0-pick') })
    if (change === 'reuse') {
      state.me!.player.team.reverse()
      probe.state = state
      await ui.redraw()
    } else {
      const terminal = await $.ui.mount(PANE(80, 'terminal'))
      await terminal.unmount()
    }
    await settle(clock)
    expect({ change, stack: probe.state.pane.stack }).toEqual({ change, stack: [] })
    await ui.unmount()
  }
})

test('image selection opens the intended card once and leaves its ordinary name Button usable', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  const state = sample('Team · slots, resting, notices with Revenge')
  probe.state = JSON.parse(JSON.stringify(state))
  const ui = await $.ui.mount(PANE(80, 'desktop'))
  const button = await ui.find({ key: 'team-0-pick' })
  const id = state.me!.player.team[0]
  await click(ui, await hitKey(ui, 'team-0-pick'), 1, 1)
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
  probe.state = JSON.parse(JSON.stringify(state))
  await ui.redraw()
  expect((await ui.find({ key: 'team-0-pick' }))?.props.label).toBe(button?.props.label)
  await ui.press({ key: 'team-0-pick' })
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
  await ui.unmount()
})

test('replacing a team card during a held click unmounts its semantic region and never picks the replacement', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  const ui = await $.ui.mount(PANE(80, 'desktop'))
  const before = await hitKey(ui, 'team-0-pick')
  await ui.resize({ in: before, columns: 18, rows: 14 })
  await ui.pointer({ in: before, type: 'down', x: 1, y: 1, button: 'left' })
  probe.state.me!.player.team.reverse()
  await ui.redraw()
  const after = await hitKey(ui, 'team-0-pick')
  expect(after).not.toBe(before)
  expect(await ui.find({ key: before })).toBeUndefined()
  await ui.resize({ in: after, columns: 18, rows: 14 })
  await ui.pointer({ in: after, type: 'up', x: 1, y: 1, button: 'left' })
  await ui.advance(16)
  await settle(clock)
  expect(probe.state.pane.stack).toEqual([])
  await ui.unmount()
})

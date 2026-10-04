// The real owning plugin loads the surface module: image/body clicks use the same action as the name Button.
import { expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import { demoSteps } from '../hooks/client/demo.ts'
import type { GameState } from '../hooks/client/types.ts'
import { PANE, engine, settle } from './engine.ts'

const NOW = Date.UTC(2026, 9, 2, 12)
const sample = (title: string) => JSON.parse(JSON.stringify(demoSteps(NOW).find(s => s.title === title)!.state)) as GameState

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

async function hitKey(ui: Mounted, button: string): Promise<string> {
  const prefix = button.replace(/-pick$/, '') + '-'
  return (await ui.findAll({ type: 'Client' })).find(n => n.key?.startsWith(prefix) && n.key.endsWith('-hit'))!.key!
}

test('desktop team and collection tiles include art, metadata and empty space in one hit region at 24 and 80 columns', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  const probe = stateProbe(on)
  for (const title of ['Team · slots, resting, notices with Revenge', 'Cards · the collection']) {
    for (const columns of [24, 80]) for (const point of [[1, 1], [17, 12]]) {
      const state = sample(title)
      probe.state = state
      const ui = await $.ui.mount(PANE(columns, 'desktop'))
      const buttons = await ui.findAll({ type: 'Button' })
      const button = buttons.find(b => title.startsWith('Team') ? b.key === 'team-0-pick' : /^card-.+-pick$/.test(b.key ?? ''))!
      expect(button).toBeDefined()
      const key = await hitKey(ui, button.key!)
      expect((await ui.find({ key }))?.props).toMatchObject({ width: '100%', height: '100%' })
      expect(buttons.filter(b => b.key === button.key)).toHaveLength(1)
      await click(ui, key, point[0]!, point[1]!)
      await settle(clock)
      expect(probe.state.pane.stack).toHaveLength(1)
      expect(probe.state.pane.stack[0]?.kind).toBe('card')
      await ui.unmount()
    }
  }
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

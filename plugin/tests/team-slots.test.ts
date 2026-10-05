// Choose a real slot before sending the existing team request, keep every card, and reject stale or pending choices.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Backend, Fx, GameState } from '../hooks/client/types.ts'
import { BackendError } from '../hooks/client/types.ts'
import { createGame, nameOf } from '../hooks/client/game.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import { teamSlotChoices } from '../hooks/client/team-slots.ts'
import { GENERATOR_VERSION, seasonSpecies } from '../hooks/core/species.ts'
import { NOW, ORIGIN, TOKEN } from './fixtures.ts'
import { PANE, engine, measure, settle, textOf } from './engine.ts'

const sample = () => JSON.parse(JSON.stringify(demoSteps(NOW).find(s => s.title === 'Card · a legendary shiny foil')!.state)) as GameState
const cardIdOf = (s: GameState) => (s.pane.stack[0] as { cardId: string }).cardId

function stateProbe(on: On) {
  const p = { state: sample(), version: 0 }
  on('state.get', (_$, e) => ({ value: { value: p.state[e.key as keyof GameState], version: p.version } }))
  on('state.set', (_$, e) => {
    Object.assign(p.state, { [e.key]: JSON.parse(JSON.stringify(e.value)) })
    return { value: { isSet: true, version: ++p.version } }
  })
  return p
}

test('slot choices replace exactly one teammate, swap existing members and fill only the next empty place', { timeoutMs: 30_000 }, () => {
  const s = sample(), id = cardIdOf(s), team = s.me!.player.team
  const untouched = JSON.stringify(s)
  for (const choice of teamSlotChoices(team, id, s.cards)) {
    expect(choice.kind).toBe('replace')
    expect(choice.card?.id).toBe(team[choice.slot])
    expect(choice.ids).toEqual(team.map((member, i) => i === choice.slot ? id : member))
  }
  for (let at = 0; at < team.length; at++) for (const choice of teamSlotChoices(team, team[at]!, s.cards)) {
    if (choice.slot === at) {
      expect(choice.kind).toBe('here')
      expect(choice.ids).toBeNull()
    } else {
      expect(choice.kind).toBe('swap')
      expect(choice.ids).toEqual(team.map((member, i) => i === choice.slot ? team[at] : i === at ? team[choice.slot] : member))
      expect([...choice.ids!].sort()).toEqual([...team].sort())
    }
  }
  for (const members of [[], team.slice(0, 1), team.slice(0, 2)]) {
    const choices = teamSlotChoices(members, id, s.cards)
    expect(choices).toHaveLength(3)
    expect(choices[members.length]!.ids).toEqual([...members, id])
    expect(choices.filter(c => c.slot > members.length).every(c => c.kind === 'empty' && c.ids === null)).toBe(true)
  }
  expect(teamSlotChoices(team, 'gone', s.cards).every(c => c.ids === null)).toBe(true)
  const held = s.cards.map(c => c.id === id ? { ...c, state: 'escrow' as const } : c)
  expect(teamSlotChoices(team, id, held).every(c => c.ids === null)).toBe(true)
  expect(teamSlotChoices([team[0]!, 'gone'], id, s.cards).every(c => c.ids === null)).toBe(true)
  expect(JSON.stringify(s)).toBe(untouched)
})

test('the wired picker shows every occupant, chooses each slot at narrow and wide widths, and Done returns to its card', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  const p = stateProbe(on)
  for (const surface of ['terminal', 'desktop'] as const) for (const columns of [24, 80]) for (const slot of [0, 1, 2]) {
    p.state = sample()
    const id = cardIdOf(p.state), original = [...p.state.me!.player.team], cards = JSON.stringify(p.state.cards)
    const before = w.requests.filter(r => r.method === 'PUT' && r.url.endsWith('/v1/team')).length
    const ui = await $.ui.mount(PANE(columns, surface))
    await ui.press({ key: 'set-team' })
    await settle(clock)
    await ui.redraw()
    expect(p.state.pane.stack.at(-1)).toEqual({ kind: 'team-slot', cardId: id })
    expect(w.requests.filter(r => r.method === 'PUT' && r.url.endsWith('/v1/team'))).toHaveLength(before)
    for (const [i, member] of original.entries()) {
      const occupant = await ui.find({ key: `team-choice-${i}-card-pick` })
      expect(occupant?.type).toBe('Button')
      expect((await ui.find({ key: `team-slot-${i}` }))?.props).toMatchObject({ hotkey: String(i + 1), label: 'Replace' })
      expect(textOf(await ui.drawn())).toContain(nameOf(p.state.cards.find(c => c.id === member)!))
    }
    expect((await ui.find({ key: 'tab-team' }))?.props.hotkey).toBeUndefined()
    const problems: string[] = []
    expect(measure(await ui.drawn(), columns, problems).w <= columns).toBe(true)
    expect(problems).toEqual([])
    await ui.press({ key: `team-slot-${slot}` })
    await settle(clock)
    await ui.redraw()
    const expected = original.map((member, i) => i === slot ? id : member)
    expect(JSON.parse(w.requests.findLast(r => r.method === 'PUT' && r.url.endsWith('/v1/team'))!.body)).toEqual({ cardIds: expected })
    expect(p.state.me!.player.team).toEqual(expected)
    expect(JSON.stringify(p.state.cards)).toBe(cards)
    expect(textOf(await ui.drawn())).toContain(`${nameOf(p.state.cards.find(c => c.id === id)!)} is now in slot ${slot + 1}.`)
    expect((await ui.find({ key: 'team-choice-done' }))?.props.label).toBe('Done')
    await ui.press({ key: 'team-choice-done' })
    await settle(clock)
    expect(p.state.pane.stack).toEqual([{ kind: 'card', cardId: id }])
    await ui.unmount()
  }
})

test('cancel preserves the team, empty places explain their order, and pending or unavailable cards expose no selection controls', { timeoutMs: 45_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  const p = stateProbe(on)
  p.state.me!.player.team = p.state.me!.player.team.slice(0, 1)
  const original = [...p.state.me!.player.team]
  const ui = await $.ui.mount(PANE(24, 'desktop'))
  await ui.press({ key: 'set-team' })
  await settle(clock)
  await ui.redraw()
  expect((await ui.find({ key: 'team-slot-1' }))?.props.label).toBe('Add here')
  expect(await ui.find({ key: 'team-slot-2' })).toBeUndefined()
  expect(textOf(await ui.drawn())).toContain('Fill earlier slot first')
  await ui.press({ key: 'team-choice-done' })
  await settle(clock)
  expect(p.state.me!.player.team).toEqual(original)
  expect(w.requests.some(r => r.method === 'PUT' && r.url.endsWith('/v1/team'))).toBe(false)
  await ui.redraw()
  await ui.press({ key: 'set-team' })
  await settle(clock)
  p.state.pane.busy = 'Setting the team'
  await ui.redraw()
  for (const slot of [0, 1, 2]) {
    expect(await ui.find({ key: `team-slot-${slot}` })).toBeUndefined()
    expect(await ui.find({ key: `team-choice-${slot}-card-pick` })).toBeUndefined()
  }
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  p.state.pane.busy = null
  p.state.cards = p.state.cards.filter(c => c.id !== cardIdOf(p.state))
  await ui.redraw()
  expect(textOf(await ui.drawn())).toContain('That card is not here any more.')
  expect(await ui.find({ key: 'team-slot-0' })).toBeUndefined()
  expect(w.requests.some(r => r.method === 'PUT' && r.url.endsWith('/v1/team'))).toBe(false)
  await ui.unmount()
  p.state = sample()
  p.state.me!.player.team = p.state.me!.player.team.slice(0, 1)
  p.state.pane = { ...p.state.pane, tab: 'team', stack: [] }
  const team = await $.ui.mount(PANE(80, 'desktop'))
  for (const slot of [1, 2]) {
    expect((await team.find({ key: `team-${slot}-pick` }))?.props.label).toBe('Pick a card')
  }
  await team.press({ key: 'team-1-pick' })
  await settle(clock)
  expect(p.state.pane.tab).toBe('cards')
  await team.unmount()
})

test('fresh-state dispatch drops removed, stale and concurrent picks and keeps backend failures visible', { timeoutMs: 30_000 }, async () => {
  let state = sample()
  const id = cardIdOf(state), members = [...state.me!.player.team]
  const ids = members.map((member, slot) => slot === 1 ? id : member)
  const picker = { cardId: id, slot: 1, team: members, world: state.account.world, server: state.account.server }
  const ready = () => {
    state = sample()
    state.pane.stack.push({ kind: 'team-slot', cardId: id, chosenSlot: 1 })
  }
  const fx: Fx = {
    now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
    fetch: async () => { throw new Error('unexpected fetch') },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true,
      openPane: async () => true, closePane: async () => undefined, blit: async () => true, sound: () => undefined },
  }
  let entered!: () => void, refuse!: (why: unknown) => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const reply = new Promise<never>((_resolve, reject) => { refuse = reject })
  const calls: unknown[] = []
  const backend = new Proxy({}, { get: (_target, op) => op === 'call' ? (name: string, req: unknown) => {
    if (name !== 'setTeam') return Promise.reject(new Error('unexpected operation'))
    calls.push(req); entered(); return reply
  } : () => Promise.reject(new Error('unexpected operation')) }) as Backend
  const game = createGame({ remote: () => backend, slots: { local: () => backend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
  const a = game.actions(fx)
  for (const change of ['removed', 'held', 'team', 'view', 'slot', 'world', 'pending']) {
    ready()
    if (change === 'removed') state.cards = state.cards.filter(c => c.id !== id)
    if (change === 'held') state.cards = state.cards.map(c => c.id === id ? { ...c, state: 'escrow' } : c)
    if (change === 'team') state.me!.player.team.reverse()
    if (change === 'view') state.pane.stack.pop()
    if (change === 'slot') state.pane.stack[state.pane.stack.length - 1] = { kind: 'team-slot', cardId: id, chosenSlot: 2 }
    if (change === 'world') state.account.world = 'offline'
    if (change === 'pending') state.pane.busy = 'Saving something'
    await a.setTeam(ids, picker)
    expect({ change, calls }).toEqual({ change, calls: [] })
  }
  ready()
  const first = a.setTeam(ids, picker)
  await started
  expect(state.pane.busy).toBe('Setting the team')
  await a.setTeam(ids, picker)
  expect(calls).toEqual([{ cardIds: ids }])
  refuse(new BackendError('conflict', 'refused', 409, 'Team changed; try again.'))
  await first
  expect(state.me!.player.team).toEqual(members)
  expect(state.pane.stack.at(-1)).toEqual({ kind: 'team-slot', cardId: id, chosenSlot: 1 })
  expect(state.pane.message).toBe('That already happened.')
  expect(state.pane.busy).toBeNull()
})

test('a same-account refresh during a team save keeps the newer team and clears only its own pending action', { timeoutMs: 30_000 }, async () => {
  for (const otherAction of [null, 'A new action']) {
    const state = sample(), id = cardIdOf(state), members = [...state.me!.player.team]
    state.pane.stack.push({ kind: 'team-slot', cardId: id, chosenSlot: 1 })
    const ids = members.map((member, slot) => slot === 1 ? id : member)
    const picker = { cardId: id, slot: 1, team: members, world: state.account.world, server: state.account.server }
    let arrive!: () => void, answer!: (res: { team: string[] }) => void
    const reached = new Promise<void>(resolve => { arrive = resolve })
    const response = new Promise<{ team: string[] }>(resolve => { answer = resolve })
    const calls: unknown[] = []
    const backend = new Proxy({}, { get: (_target, op) => op === 'call' ? (name: string, req: unknown) => {
      if (name !== 'setTeam') return Promise.reject(new Error('unexpected operation'))
      calls.push(req); arrive(); return response
    } : () => Promise.reject(new Error('unexpected operation')) }) as Backend
    const fx: Fx = {
      now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
      fetch: async () => { throw new Error('unexpected fetch') },
      store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
      state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
      ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true,
        openPane: async () => true, closePane: async () => undefined, blit: async () => true, sound: () => undefined },
    }
    const game = createGame({ remote: () => backend, slots: { local: () => backend, battle: async () => undefined, reveal: async () => undefined, moments: null } })
    const writing = game.actions(fx).setTeam(ids, picker)
    await reached
    expect(state.pane.busy).toBe('Setting the team')
    // An authoritative refresh from another device wins while the original request waits.
    const newer = [...members].reverse()
    state.me = { ...state.me!, player: { ...state.me!.player, team: newer } }
    if (otherAction) state.pane = { ...state.pane, busy: otherAction, message: 'New action started' }
    answer({ team: ids })
    await writing
    expect(calls).toEqual([{ cardIds: ids }])
    expect(state.me!.player.team).toEqual(newer)
    expect(state.pane.busy).toBe(otherAction)
    if (otherAction) expect(state.pane.message).toBe('New action started')
  }
})

test('world switches and same-world account resets cannot send old ids or overwrite the new team across asynchronous boundaries', { timeoutMs: 30_000 }, async () => {
  for (const boundary of ['read', 'clock', 'response', 'update', 'reset'] as const) {
    let state = sample()
    if (boundary === 'reset') state.account.world = 'offline'
    const id = cardIdOf(state), members = [...state.me!.player.team]
    state.pane.stack.push({ kind: 'team-slot', cardId: id, chosenSlot: 1 })
    const ids = members.map((member, slot) => slot === 1 ? id : member)
    const picker = { cardId: id, slot: 1, team: members, world: state.account.world, server: state.account.server }
    const next = sample()
    next.cards = next.cards.map(c => ({ ...c, id: `local-${c.id}` }))
    next.me!.player.team = next.me!.player.team.map(member => `local-${member}`)
    const calls: { world: string; op: string; req: unknown }[] = []
    const store = new Map<string, unknown>()
    let arrive!: () => void, release!: () => void, held = false, changing = false, now = NOW
    const reached = new Promise<void>(resolve => { arrive = resolve })
    const pause = new Promise<void>(resolve => { release = resolve })
    const hold = async () => { held = true; arrive(); await pause }
    let a!: ReturnType<ReturnType<typeof createGame>['actions']>
    const move = async () => {
      changing = true
      if (boundary === 'reset') {
        await a.hold('delete-account', 'me')
        now += 2000
        await a.hold('delete-account', 'me')
      } else await a.world('offline')
      state.pane = { ...state.pane, stack: [], busy: 'A new action', message: 'New world' }
    }
    const backend = (world: string) => new Proxy({}, { get: (_target, member) => async (op: string | unknown, req?: unknown) => {
      const name = member === 'call' ? op as string : member as string
      const body = member === 'call' ? req : op
      if (name === 'setTeam') {
        calls.push({ world, op: name, req: body })
        if (boundary === 'response' || boundary === 'reset') await hold()
        return { team: ids }
      }
      if (name === 'deleteMe') return { deleted: true }
      if (name === 'me') return structuredClone(next.me)
      if (name === 'cards') return { cards: structuredClone(next.cards), version: next.me!.player.cardsVersion }
      if (name === 'season') {
        const season = (body as { season: number }).season
        return { season, generator: GENERATOR_VERSION, species: seasonSpecies(season) }
      }
      throw new Error(`Unexpected operation ${name}`)
    } }) as Backend
    const fx: Fx = {
      now: async () => { if (boundary === 'clock' && !held && !changing) await hold(); return now },
      random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
      fetch: async () => { throw new Error('unexpected fetch') },
      store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) },
        delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] },
      state: {
        get: async key => {
          const value = state[key]
          if (boundary === 'read' && key === 'me' && !held && !changing) await hold()
          return value
        },
        update: async (key, fn) => {
          if (boundary === 'update' && key === 'me' && calls.length && !changing) { arrive(); await move() }
          state[key] = fn(state[key]); return state[key]
        },
      },
      ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true,
        openPane: async () => true, closePane: async () => undefined, blit: async () => true, sound: () => undefined },
    }
    const game = createGame({ remote: () => backend('online'), slots: { local: () => backend('offline'), battle: async () => undefined, reveal: async () => undefined, moments: null } })
    a = game.actions(fx)
    const writing = a.setTeam(ids, picker)
    await reached
    if (boundary !== 'update') await move()
    release()
    await writing
    expect(state.account.world).toBe('offline')
    expect(state.me!.player.team).toEqual(next.me!.player.team)
    expect(state.pane).toMatchObject({ busy: 'A new action', message: 'New world' })
    expect(calls).toEqual(boundary === 'read' || boundary === 'clock' ? [] : [{ world: boundary === 'reset' ? 'offline' : 'online', op: 'setTeam', req: { cardIds: ids } }])
  }
})

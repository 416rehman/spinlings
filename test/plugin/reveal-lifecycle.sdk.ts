// A retained ceremony callback and a delayed backup nudge belong to the reveal that created them.
import { expect, test } from 'claude-code/testing'
import type { ApiOp } from '../../plugin/hooks/core/api.ts'
import { GENERATOR_VERSION, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { createGame } from '../../plugin/hooks/client/game.ts'
import { uiScenes } from './ui-scenes.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import type { Backend, El, Fx } from '../../plugin/hooks/client/types.ts'
import { pane } from '../../plugin/hooks/ui/pane.tsx'
import { NOW, ORIGIN } from './fixtures.ts'

function subject() {
  const state = structuredClone(uiScenes(NOW).find(s => s.title === 'Pack · a legendary foil revealed')!.state)
  state.account = { ...state.account, backedUp: false, devices: { sessions: 1, passkeys: 0 } }
  state.reveal = { ...state.reveal!, id: 'original', kind: 'craft' }
  const me = structuredClone(state.me!)
  const store = new Map<string, unknown>([[KEYS.prefs, { world: 'online', server: ORIGIN }], [KEYS.meta(ORIGIN), {}]])
  const sent: string[] = []
  const collections = { online: structuredClone(state.cards), offline: state.cards.map(c => ({ ...structuredClone(c), id: `local-${c.id}` })) }
  const backend = (world: 'online' | 'offline') => {
    const call = async (op: ApiOp, req: unknown) => {
      sent.push(`${world}:${op}`)
      if (op === 'season') {
        const season = (req as { season: number }).season
        return { season, generator: GENERATOR_VERSION, species: seasonSpecies(season) }
      }
      if (op === 'craft') {
        const card = { ...collections[world][0]!, id: `${world}-replacement`, rarity: 'common' as const,
          shiny: false, foil: undefined, firstFind: undefined, bound: false, origin: 'craft' as const }
        collections[world].push(card)
        return { card }
      }
      if (op === 'me') return { ...structuredClone(me), player: { ...me.player,
        team: collections[world].slice(0, 3).map(c => c.id), cardsVersion: 8 } }
      if (op === 'cards') return { cards: collections[world], version: 8 }
      throw new Error(`Unexpected ${op}`)
    }
    return new Proxy({}, { get: (_target, member: string) => member === 'call' ? call : (req: unknown) => call(member as ApiOp, req) }) as Backend
  }
  const fx: Fx = {
    now: async () => NOW, random: () => .5, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }),
    fetch: async () => { throw new Error('unexpected fetch') },
    store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) },
      delete: async key => { store.delete(key) }, keys: async () => [...store.keys()] },
    state: { get: async key => state[key], update: async (key, fn) => { state[key] = fn(state[key]); return state[key] } },
    ui: { toast: () => undefined, status: () => undefined, log: () => undefined, copy: async () => true,
      openPane: async () => true, closePane: async () => undefined, blit: async () => true, sound: () => undefined },
  }
  const game = createGame({ remote: () => backend('online'), slots: { local: () => backend('offline'),
    battle: async () => undefined, reveal: async () => undefined, moments: null } })
  return { state, store, sent, fx, game, actions: game.actions(fx) }
}

test('a delayed Close preserves the replacement reveal, its progress and new metadata across world switches', { timeoutMs: 30_000 }, async () => {
  for (const boundary of ['meta-first', 'meta-save', 'reveal-update', 'pane-update']) for (const move of ['replacement', 'offline']) {
    const p = subject(), { fx } = p
    let reached!: () => void, release!: () => void, held = false, reads = 0
    const arrived = new Promise<void>(resolve => { reached = resolve })
    const pause = new Promise<void>(resolve => { release = resolve })
    const hold = async () => { held = true; reached(); await pause }
    const read = fx.store.get
    fx.store.get = async key => {
      const value = await read(key)
      if (key === KEYS.meta(ORIGIN) && ++reads === (boundary === 'meta-first' ? 1 : boundary === 'meta-save' ? 2 : 0) && !held) await hold()
      return value
    }
    const update = fx.state.update
    fx.state.update = async (key, fn) => {
      if (!held && (boundary === 'reveal-update' && key === 'reveal' || boundary === 'pane-update' && key === 'pane')) await hold()
      return update(key, fn)
    }
    const closing = p.actions.doneReveal('original')
    await arrived
    if (move === 'offline') await p.actions.world('offline')
    await p.actions.craft('s1-opus-0', 'common')
    expect(p.state.reveal?.id).not.toBe('original')
    const replacement = structuredClone(p.state.reveal)
    p.state.pane = { ...p.state.pane, flipped: 1, message: 'New reveal', busy: 'A new action' }
    const newPane = structuredClone(p.state.pane), moments = structuredClone(p.state.moments)
    const metadata = { passkeyDay: 'saved', marker: 'new account' }
    p.store.set(KEYS.meta(ORIGIN), metadata)
    release()
    await closing
    expect({ boundary, move, reveal: p.state.reveal }).toEqual({ boundary, move, reveal: replacement })
    expect(p.state.pane).toEqual(newPane)
    expect(p.state.moments).toEqual(moments)
    expect(p.store.get(KEYS.meta(ORIGIN))).toEqual(metadata)
    expect(p.state.account.world).toBe(move === 'offline' ? 'offline' : 'online')
    expect(p.sent.filter(op => op.endsWith(':craft'))).toEqual([`${move === 'offline' ? 'offline' : 'online'}:craft`])
  }
})

test('opened ceremony buttons retain their reveal ID, so old Flip and Done never act on a replacement', { timeoutMs: 45_000 }, async ($, on) => {
  const p = subject()
  p.state.account.backedUp = true
  let retained: (() => Promise<unknown>) | undefined, capture = ''
  on('ui.render', { component: 'Pane', requestId: 'reveal-lifecycle' }, ($, e) => {
    const raw = { ...$.ui.resolve(e) } as unknown as El
    const el = new Proxy(raw, { get: (target, key) => key === 'Button' ? (...args: Parameters<El['Button']>) => {
      const props = args[0]
      if (props.key === capture && typeof props.onPress === 'function') retained = props.onPress as () => Promise<unknown>
      return target.Button(...args)
    } : target[key as keyof El] }) as El
    return pane({ el, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
      actions: p.actions, focused: true, placement: 'inline', state: p.state })
  })
  const old = structuredClone(p.state.reveal!)
  for (const surface of ['terminal', 'desktop'] as const) for (const stage of ['flip', 'pack-done', 'single-done']) {
    p.state.reveal = { ...structuredClone(old), id: `old-${surface}-${stage}`, kind: stage === 'single-done' ? 'craft' : 'pack', torn: true }
    p.state.pane = { ...p.state.pane, stack: [{ kind: 'reveal' }], flipped: stage === 'flip' ? 0 : 1 }
    retained = undefined
    capture = stage === 'flip' ? 'flip' : 'done'
    const ui = await $.ui.mount({ plugin: 'spinlings', component: 'Pane', requestId: 'reveal-lifecycle', surface,
      viewport: { columns: 44, rows: 40 }, props: { title: 'Spinlings', isFocused: true, bodyColumns: 40,
        placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    expect(await ui.find({ key: capture })).toBeDefined()
    expect(retained).toBeDefined()
    const invoke = retained!
    p.state.reveal = { ...structuredClone(old), id: `new-${surface}-${stage}`, kind: 'craft' }
    p.state.pane.flipped = 0
    const replacement = structuredClone(p.state.reveal), before = structuredClone(p.state.pane)
    await invoke()
    expect(p.state.reveal).toEqual(replacement)
    expect(p.state.pane).toEqual(before)
    await ui.unmount()
  }
  await p.actions.flip()
  expect(p.state.pane.flipped).toBe(1)
  await p.actions.doneReveal()
  expect(p.state.reveal).toBeNull()
  expect(p.state.pane.stack).toEqual([])
})

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { uiScenes } from './ui-scenes.ts'
import type { GameState } from '../../plugin/hooks/client/types.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { wantWords } from '../../plugin/hooks/client/viewmodels.ts'
import { frameOf, rarityLabel } from '../../plugin/hooks/ui/card.tsx'
import { PANE, RUN, SESSION, engine, measure, settle, textOf } from './engine.ts'

const NOW = Date.UTC(2026, 9, 2, 12)
function sample(): GameState {
  const s = JSON.parse(JSON.stringify(uiScenes(NOW).find(x => x.title === 'Card · a legendary shiny foil')!.state)) as GameState
  const card = s.cards.find(c => !c.bound && c.rarity === 'common' && c.species.startsWith('s'))!
  card.shiny = true
  card.foil = true
  s.pane.stack = [{ kind: 'card', cardId: card.id }]
  return s
}

function probe(on: On) {
  const p = { state: sample(), version: 0 }
  on('state.get', (_$, e) => ({ value: { value: p.state[e.key as keyof GameState], version: p.version } }))
  on('state.set', (_$, e) => {
    Object.assign(p.state, { [e.key]: e.value })
    return { value: { isSet: true, version: ++p.version } }
  })
  return p
}

test('rarity and two independent cosmetic finishes retain their labels and existing frames', () => {
  const base = { species: 's1-haiku-0', rarity: 'common' as const, shiny: false }
  for (const [shiny, foil, label] of [
    [false, false, 'Common'], [true, false, 'Common · Alt colour'],
    [false, true, 'Common · Foil'], [true, true, 'Common · Alt colour · Foil'],
  ] as const) {
    const card = { ...base, shiny, ...(foil ? { foil: true as const } : {}) }
    expect(rarityLabel(card)).toBe(label)
    expect(frameOf(card)).toMatchObject({ rainbow: foil, sparkle: shiny })
  }
  expect(rarityLabel({ ...base, species: 'mythic', shiny: false, foil: true })).toBe('Mythic · Foil')
  expect(wantWords({ family: 'haiku', shiny: true, foil: true })).toBe('any Haiku · Alt colour · Foil')
})

test('finished card details explain actual looks on demand at narrow widths; plain cards add no disclosure', { timeoutMs: 90_000 }, async ($, on) => {
  const w = engine(on), p = probe(on)
  for (const surface of ['terminal', 'desktop'] as const) for (const columns of [24, 80]) {
    for (const [shiny, foil] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      p.state = sample()
      const view = p.state.pane.stack.at(-1)!
      if (view.kind !== 'card') throw new Error('a card detail fixture is required')
      const card = p.state.cards.find(c => c.id === view.cardId)!
      card.shiny = shiny
      if (foil) card.foil = true
      else delete card.foil
      const original = JSON.stringify(p.state.cards)
      const ui = await $.ui.mount(PANE(columns, surface))
      const text = textOf(await ui.drawn())
      expect(text).toContain(rarityLabel(card))
      expect(text.includes('different palette')).toBe(false)
      const button = await ui.find({ key: 'card-looks' })
      if (!shiny && !foil) {
        expect(button).toBeUndefined()
        expect(text.includes('recycle value by')).toBe(false)
      } else {
        expect(button?.props).toMatchObject({ label: '? Looks', hotkey: 'a' })
        await ui.press({ key: 'card-looks' })
        await ui.redraw()
        const shown = textOf(await ui.drawn())
        expect(shown.includes('Alt colour: a different palette and a sparkle.')).toBe(shiny)
        expect(shown.includes('Foil: a rainbow frame and shimmer.')).toBe(foil)
        expect(shown).toContain('no battle-stat bonus. Rarity is separate.')
        const multiplier = (shiny ? ECONOMY.recycleShiny : 1) * (foil ? ECONOMY.recycleFoil : 1)
        expect(shown).toContain(`The finishes multiply recycle value by ${multiplier}×.`)
        expect((await ui.find({ key: 'card-looks' }))?.props.label).toBe('Hide looks')
        const problems: string[] = []
        expect(measure(await ui.drawn(), columns, problems).w <= columns).toBe(true)
        expect(problems).toEqual([])
        await ui.press({ key: 'card-looks' })
        await ui.redraw()
        expect(textOf(await ui.drawn()).includes('different palette')).toBe(false)
      }
      expect(JSON.stringify(p.state.cards)).toBe(original)
      await ui.unmount()
    }
  }
  expect(w.requests).toEqual([])
})

test('a retained Looks button cannot change a replacement card view or another screen', { timeoutMs: 60_000 }, async ($, on) => {
  engine(on)
  const p = probe(on)
  for (const next of [{ kind: 'card' as const, cardId: 'other-card' }, { kind: 'help' as const }]) {
    p.state = sample()
    const ui = await $.ui.mount(PANE(24, 'desktop'))
    expect(await ui.find({ key: 'card-looks' })).toBeDefined()
    p.state.pane.stack = [next]
    await ui.press({ key: 'card-looks' })
    expect(p.state.pane.stack).toEqual([next])
    await ui.unmount()
  }
})

test('the Alt colour market control keeps the existing shiny filter on the wire', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('market'))
  await settle(clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(24, surface))
    expect((await ui.find({ key: 'chip-shiny' }))?.props.label).toBe('Alt colour')
    await ui.press({ key: 'chip-shiny' })
    await settle(clock)
    const request = w.requests.findLast(r => new URL(r.url).pathname === '/v1/market')!
    expect(new URL(request.url).searchParams.get('shiny')).toBe('true')
    expect(new URL(request.url).searchParams.has('altColour')).toBe(false)
    await ui.press({ key: 'chip-shiny' })
    await settle(clock)
    const cleared = w.requests.findLast(r => new URL(r.url).pathname === '/v1/market')!
    expect(new URL(cleared.url).searchParams.has('shiny')).toBe(false)
    await ui.unmount()
  }
})

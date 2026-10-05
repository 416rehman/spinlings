// The pane's quality gate (SPEC 21, 35): every screen of /spin demo mounts at 50, 80 and 120 columns on the terminal
// and the desktop with no refused tree, no overflow, one meaning per key, a primary action only on 1 (or o), a hint
// row, guidance in every empty state and art wherever cards show. Then the screens are walked by pressing keys.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Actions, El, GameState, View } from '../hooks/client/types.ts'
import { INITIAL, MARKET_DEFAULT, communitySection, nameOf } from '../hooks/client/game.ts'
import { demoSteps } from '../hooks/client/demo.ts'
import {
  bestTeam, cardCan, collection, holdText, paged, revealSummary, statTiles, teamPlace, tradeSection, traderPicks,
} from '../hooks/client/viewmodels.ts'
import { traderDeals } from '../hooks/core/trader.ts'
import { pane } from '../hooks/ui/pane.tsx'
import { cardArt, measure } from './engine.ts'

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const WIDTHS = [50, 80, 120] as const
const SURFACES = ['terminal', 'desktop'] as const

type Call = [string, unknown[]]
type Probe = { state: GameState; calls: Call[] }
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

/** Actions that record every call and play the pane-local ones the way the game does. */
function fakeActions(p: Probe, redraw: () => void): Actions {
  const setPane = (f: (x: GameState['pane']) => GameState['pane']) => { p.state = { ...p.state, pane: f(p.state.pane) } }
  const rec = (name: string, play?: (...a: never[]) => void) => async (...args: unknown[]) => {
    p.calls.push([name, args])
    play?.(...(args as never[]))
    redraw()
  }
  return {
    press: rec('press'), pickCatch: rec('pickCatch'), act: rec('act'), dismiss: rec('dismiss'), open: rec('open'), close: rec('close'),
    tab: rec('tab', (t: GameState['pane']['tab']) => setPane(x => ({ ...x, tab: t === 'market' ? 'trade' : t, community: t === 'market' ? 'market' : communitySection(x), stack: [], page: 0, hold: null, message: '', hello: false }))),
    community: rec('community', (section: NonNullable<GameState['pane']['community']>) => setPane(x => ({ ...x, tab: 'trade', community: section, stack: [], page: 0, hold: null, message: '', hello: false }))),
    push: rec('push', (v: View) => setPane(x => ({ ...x, stack: [...x.stack, v] }))),
    back: rec('back', () => setPane(x => ({ ...x, stack: x.stack.slice(0, -1), hold: null }))),
    pane: rec('pane', (f: (x: GameState['pane']) => GameState['pane']) => setPane(f)),
    hold: rec('hold', (action: never, target: string) => setPane(x => ({ ...x, hold: { action, target, startedAt: NOW } }))),
    openPack: rec('openPack'),
    flip: rec('flip', () => { const r = p.state.reveal; if (r) setPane(x => ({ ...x, flipped: Math.min(r.cards.length, x.flipped + 1) })) }),
    doneReveal: rec('doneReveal', () => { p.state = { ...p.state, reveal: null }; setPane(x => ({ ...x, flipped: 0, stack: x.stack.filter(v => v.kind !== 'reveal') })) }),
    setTeam: rec('setTeam'), setForTrade: rec('setForTrade'), craft: rec('craft'), buyPack: rec('buyPack'), share: rec('share'), shareProfile: rec('shareProfile'), copyUpdate: rec('copyUpdate'),
    duel: rec('duel'), challenge: rec('challenge'), market: rec('market'), list: rec('list'), buy: rec('buy'), prices: rec('prices'),
    rankings: rec('rankings', (board: never, period: never) => setPane(x => ({ ...x, page: 0, boards: { board, period }, stack: x.stack.map(v => (v.kind === 'boards' ? { ...v, board, period } : v)) }))),
    marketFilter: rec('marketFilter', (change: object) => setPane(x => ({ ...x, page: 0, market: { ...(x.market ?? MARKET_DEFAULT), ...change } }))),
    profile: rec('profile'), load: rec('load'), offer: rec('offer'), respond: rec('respond'), counter: rec('counter'),
    claim: rec('claim'), redeem: rec('redeem'), wishlist: rec('wishlist'), trade: rec('trade'), world: rec('world'), connect: rec('connect'),
    passkey: rec('passkey'), rerollHandle: rec('rerollHandle'), leaderboard: rec('leaderboard'), prefs: rec('prefs'),
  }
}

/**
 * Draws the pane from the probe's state beneath the plugins, as register.tsx's PANE slot does (an inline plugin
 * cannot close over this file's imports). Acts redraw explicitly: the probe's state is not $.state.
 */
function draws(on: On, p: Probe): void {
  on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => pane({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows, now: NOW,
    actions: fakeActions(p, () => undefined), focused: true, placement: 'inline', state: p.state,
  }))
}

type Ui = { press(t: { key: string; plugin?: string }): Promise<unknown>; input(t: { key: string; text: string; plugin?: string }): Promise<unknown>; redraw(): Promise<void> }

async function press(ui: Ui, key: string): Promise<void> {
  await ui.press({ key, plugin: 'test' })
  await ui.redraw()
}

async function type(ui: Ui, key: string, text: string): Promise<void> {
  await ui.input({ key, text, plugin: 'test' })
  await ui.redraw()
}

const MOUNT = (columns: number, surface: (typeof SURFACES)[number]) => ({
  plugin: 'spinlings', surface, component: 'Pane', requestId: 'probe', viewport: { columns: columns + 4, rows: 40 },
  props: { title: 'Spinlings', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}) as const

function walk(n: unknown, f: (n: Node) => void): void {
  if (!n || typeof n !== 'object' || !('type' in n)) return
  f(n as Node)
  for (const c of (n as Node).children ?? []) walk(c, f)
}

function all(tree: unknown, type: string): Node[] {
  const out: Node[] = []
  walk(tree, n => { if (n.type === type) out.push(n) })
  return out
}

function textOf(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!n || typeof n !== 'object') return ''
  const node = n as Node
  if (node.type === 'Button') return String(node.props?.label ?? '')
  return (node.children ?? []).map(textOf).join('')
}

/** The fewest cells a node needs across: Rasters, fixed widths, buttons, rows of them; text shrinks and wraps. */
function minWidth(n: unknown): number {
  if (!n || typeof n !== 'object' || !('type' in n)) return 0
  const node = n as Node
  const p = node.props ?? {}
  const kids = node.children ?? []
  if (node.type === 'Raster') return Number(p.columns)
  if (node.type === 'Button') return String(p.label ?? '').length + (p.hotkey ? 3 : 0) + (p.plain ? 0 : 4)
  if (node.type !== 'Box') return 0
  const border = p.borderStyle ? 2 : 0
  const inner = (p.flexDirection ?? 'row') === 'row' && p.flexWrap !== 'wrap'
    ? kids.reduce<number>((sum, k) => sum + minWidth(k), 0) + Math.max(0, kids.filter(k => typeof k === 'object').length - 1) * Number(p.columnGap ?? p.gap ?? 0)
    : Math.max(0, ...kids.map(minWidth))
  return Math.max(typeof p.width === 'number' ? p.width : 0, inner + border)
}

/** The gate every screen passes (SPEC 21 quality gate). */
function gate(tree: unknown, columns: number, where: string): void {
  const buttons = all(tree, 'Button')
  const keys = buttons.map(b => b.props?.hotkey).filter((k): k is string => typeof k === 'string')
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  expect({ where, dupes }).toEqual({ where, dupes: [] })
  for (const b of buttons) {
    if (b.props?.variant === 'primary') expect({ where, primary: b.props?.label, hotkey: ['1', 'o'].includes(String(b.props?.hotkey)) }).toEqual({ where, primary: b.props?.label, hotkey: true })
  }
  walk(tree, n => {
    if (n.type === 'Box' && typeof n.props?.width === 'number') expect({ where, width: n.props.width as number <= columns }).toEqual({ where, width: true })
  })
  expect({ where, min: minWidth(tree) <= columns }).toEqual({ where, min: true })
  const rasterKeys = all(tree, 'Raster').map(r => String(r.props?.key))
  expect({ where, rasterKeys: rasterKeys.filter((k, i) => rasterKeys.indexOf(k) !== i) }).toEqual({ where, rasterKeys: [] })
}

// The probe plugin draws from this; each test sets the state it needs.
const p: Probe = { state: INITIAL, calls: [] }

test('every screen of /spin demo draws at 50, 80 and 120 columns on the terminal and the desktop', { timeoutMs: 240_000 }, async ($, on) => {
  draws(on, p)
  const steps = demoSteps(NOW)
  expect(steps.length).toBeGreaterThan(40)
  for (const step of steps) {
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        p.state = step.state
        const where = `${step.title} @${columns} ${surface}`
        const ui = await $.ui.mount(MOUNT(columns, surface))
        const tree = await ui.drawn()
        gate(tree, columns, where)
        const hint = textOf((tree as Node).children?.at(-1))
        expect({ where, hint: hint.length > 0 }).toEqual({ where, hint: true })
        if (surface === 'desktop') expect({ where, rasters: all(tree, 'Raster').length }).toEqual({ where, rasters: 0 })
        else expect({ where, svgs: all(tree, 'Svg').length }).toEqual({ where, svgs: 0 })
        await ui.unmount()
      }
    }
  }
})

test('every pane demo screen fits 24 columns, including its wrapped text and fixed controls', { timeoutMs: 120_000 }, async ($, on) => {
  draws(on, p)
  for (const step of demoSteps(NOW).filter(s => !s.band)) {
    for (const surface of SURFACES) {
      p.state = step.state
      const where = `${step.title} @24 ${surface}`
      const ui = await $.ui.mount(MOUNT(24, surface))
      const tree = await ui.drawn()
      gate(tree, 24, where)
      const problems: string[] = []
      const size = measure(tree, 24, problems)
      expect({ where, problems, fits: size.w <= 24 }).toEqual({ where, problems: [], fits: true })
      await ui.unmount()
    }
  }
})

/** Every creature name a state can show: your cards, listings, offers, a profile's cards. */
function namesIn(s: GameState): string[] {
  const faces = [
    ...s.cards, ...(s.me?.listings ?? []).map(l => l.card), ...(s.social.market?.listings ?? []).map(l => l.card),
    ...(s.me?.offers.incoming ?? []).flatMap(o => [...o.give, ...o.get]), ...(s.social.profile?.team ?? []), ...(s.social.profile?.forTrade ?? []),
  ]
  return [...new Set(faces.map(nameOf))].filter(n => n.length >= 5)
}

test('names are never cut, and every card tile with art is one control: its art over a button that opens it', { timeoutMs: 300_000 }, async ($, on) => {
  draws(on, p)
  for (const step of demoSteps(NOW).filter(s => !s.band)) {
    const names = namesIn(step.state)
    for (const surface of SURFACES) {
      for (const columns of WIDTHS) {
        p.state = step.state
        const where = `${step.title} @${columns} ${surface}`
        const ui = await $.ui.mount(MOUNT(columns, surface))
        const tree = await ui.drawn()
        const shown: string[] = []
        walk(tree, n => { if (n.type === 'Text' || n.type === 'Button') shown.push(textOf(n)) })
        const cut = names.filter(name => shown.some(s => [...Array(name.length - 3).keys()].some(k => s.includes(`${name.slice(0, k + 3)}…`))))
        expect({ where, cut }).toEqual({ where, cut: [] })
        if (surface === 'terminal') {
          const buttons = new Set(all(tree, 'Button').map(b => String(b.props?.key ?? '')))
          // a profile's team is shown, not picked; a listing's wanted creature is part of its tile
          const tiles = all(tree, 'Raster').map(r => String(r.props?.key ?? ''))
            .filter(k => /^(card|listing|team|mine|their|partner|fit)-.+-art$/.test(k) && !/-want-|^their-team-|^listing-card-art$/.test(k))
          const unpressable = tiles.filter(k => !buttons.has(k.replace(/-art$/, '-pick')))
          expect({ where, unpressable }).toEqual({ where, unpressable: [] })
        }
        await ui.unmount()
      }
    }
  }
})

test('empty states carry guidance on both surfaces', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const steps = demoSteps(NOW)
  const guidance: [string, RegExp][] = [
    ['Cards · empty collection', /Creatures show up while Claude works/],
    ['Team · a brand-new player', /Your team forms as your first cards arrive/],
    ['Trade · empty inbox', /No offers yet/],
    ['Cards · a filter with nothing in it', /Press m or y to change the filters/],
    ['First run · hatching', /Hatching your first Spinling/],
    ['Album · Fable, mostly unseen', /Silhouettes are species you have not met yet|Fable/],
    ['Boards · hidden, and nobody yet', /Nobody on this board yet\. The first name here could be yours\./],
  ]
  for (const [title, text] of guidance) {
    p.state = steps.find(s => s.title === title)!.state
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(MOUNT(50, surface))
      expect({ title, found: !!(await ui.find({ text })) }).toEqual({ title, found: true })
      // a hidden player has no row of their own on a board (the server sends none)
      if (title.startsWith('Boards')) expect(await ui.find({ text: /^You · / })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('the clipboard is named only when a copy took: otherwise a gift\'s two lines and a share\'s text show, to copy by hand', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const steps = demoSteps(NOW)
  const textAt = async (title: string, surface: (typeof SURFACES)[number]) => {
    p.state = steps.find(s => s.title === title)!.state
    const ui = await $.ui.mount(MOUNT(80, surface))
    const text = textOf(await ui.drawn())
    await ui.unmount()
    return text
  }
  for (const surface of SURFACES) {
    const byHand = await textAt('Trade · a gift just wrapped, to copy by hand', surface)
    expect({ surface, send: /Send your friend these lines:/.test(byHand), clipboard: /clipboard/.test(byHand) }).toEqual({ surface, send: true, clipboard: false })
    expect(byHand).toContain('https://spinlings.dev/g/quiet-otter-lamp-4821')
    expect(byHand).toContain('/spin claim quiet-otter-lamp-4821')
    expect(await textAt('Trade · a gift just wrapped', surface)).toMatch(/The link and the claim command are on your clipboard/)
    const share = await textAt('Card · a share to copy by hand (no clipboard here)', surface)
    expect({ surface, lead: /To share it, copy this:/.test(share), copied: /Copied/.test(share) }).toEqual({ surface, lead: true, copied: false })
    expect(share).toMatch(/https:\/\/spinlings\.dev\/c\//)
  }
})

test('cards show as art wherever they appear: the grid, the team, the album', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const steps = demoSteps(NOW)
  const art = (title: string) => steps.find(s => s.title === title)!.state
  for (const surface of SURFACES) {
    const kind = surface === 'terminal' ? 'Raster' : 'Svg'
    p.state = art('Cards · the collection')
    let ui = await $.ui.mount(MOUNT(120, surface))
    const tiles = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-'))
    expect(tiles.length).toBeGreaterThan(0)
    expect(cardArt(await ui.findAll({ type: kind })).length).toBe(tiles.length)
    await ui.unmount()
    p.state = art('Album · Opus')
    ui = await $.ui.mount(MOUNT(80, surface))
    expect(cardArt(await ui.findAll({ type: kind })).length).toBe(9)
    await ui.unmount()
    p.state = art('Team · slots, resting, notices with Revenge')
    ui = await $.ui.mount(MOUNT(80, surface))
    expect(cardArt(await ui.findAll({ type: kind })).length).toBe(3)
    expect(await ui.find({ text: /Resting · 12 min/ })).toBeDefined()
    await ui.unmount()
  }
})

test('tabs switch with 1-4 on a tab, and a pushed view keeps the digits for its own choices', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const team = demoSteps(NOW).find(s => s.title === 'Team · slots, resting, notices with Revenge')!.state
  p.state = team
  p.calls = []
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect((await ui.find({ key: 'tab-cards' }))?.props.hotkey).toBe('2')
  expect((await ui.find({ key: 'open-pack' }))?.props).toMatchObject({ hotkey: 'o', variant: 'primary' })
  expect((await ui.find({ key: 'duel' }))?.props.hotkey).toBe('b')
  expect((await ui.find({ key: 'revenge-n1' }))?.props.hotkey).toBe('r')
  await press(ui, 'revenge-n1')
  expect(p.calls.at(-1)).toEqual(['duel', ['soft-otter-42']])
  await press(ui, 'tab-cards')
  expect(p.state.pane.tab).toBe('cards')
  expect(await ui.find({ key: 'filter-family' })).toBeDefined()
  await press(ui, 'filter-family')
  expect(p.state.pane.family).toBe('haiku')
  await press(ui, 'filter-family')
  await press(ui, 'filter-family')
  await press(ui, 'filter-family')
  await press(ui, 'filter-family')
  expect(p.state.pane.family).toBe('all')
  const first = (await ui.findAll({ type: 'Button' })).find(b => String(b.key).startsWith('card-'))!
  await press(ui, first.key!)
  expect(p.state.pane.stack.at(-1)?.kind).toBe('card')
  expect((await ui.find({ key: 'tab-cards' }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'share' }))?.props.hotkey).toBe('s')
  expect((await ui.find({ key: 'pane-back' }))?.props.label).toBe('Back')
  await ui.unmount()
})

test('a card page: set in team in place of the weakest, mark for trade, recycle and gift behind a 2-second hold', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Card · a legendary shiny foil')!.state
  p.state = s
  p.calls = []
  const cardId = (s.pane.stack[0] as { cardId: string }).cardId
  for (const surface of SURFACES) {
    p.state = s
    const ui = await $.ui.mount(MOUNT(80, surface))
    const set = await ui.find({ key: 'set-team' })
    expect(set?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
    expect(String(set?.props.label)).toMatch(/^Set in team, for /)
    await press(ui, 'set-team')
    const [name, args] = p.calls.at(-1)!
    expect(name).toBe('setTeam')
    expect((args[0] as string[]).includes(cardId)).toBe(true)
    await press(ui, 'for-trade')
    expect(p.calls.at(-1)).toEqual(['setForTrade', [cardId, true]])
    await press(ui, 'recycle')
    expect(p.calls.at(-1)).toEqual(['hold', ['recycle', cardId]])
    expect(await ui.find({ text: /will be gone\. You get \d+ sparks\. Press x again in 2 s to recycle\./ })).toBeDefined()
    await press(ui, 'gift')
    expect(await ui.find({ text: /wrapped and held until someone claims it/ })).toBeDefined()
    await ui.unmount()
  }
  const starter = demoSteps(NOW).find(x => x.title === 'Card · a starter (stays with you)')!.state
  p.state = starter
  const ui = await $.ui.mount(MOUNT(50, 'terminal'))
  expect(await ui.find({ key: 'recycle' })).toBeUndefined()
  expect(await ui.find({ key: 'gift' })).toBeUndefined()
  expect(await ui.find({ text: /Stays with you/ })).toBeDefined()
  await ui.unmount()
})

test('fusing: pick a partner with 1-3, then fuse behind a hold with the cost in view', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Fuse · pick a partner')!.state
  p.state = s
  p.calls = []
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  const picks = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('partner-'))
  expect(picks.length).toBeGreaterThan(2)
  expect(picks.slice(0, 3).map(b => b.props.hotkey)).toEqual(['1', '2', '3'])
  await press(ui, picks[1]!.key!)
  const top = p.state.pane.stack.at(-1) as { kind: string; cardId: string; otherId: string | null }
  expect(top.kind).toBe('fuse')
  expect(top.otherId).not.toBeNull()
  expect(await ui.find({ key: 'fuse-go' })).toBeDefined()
  await press(ui, 'fuse-go')
  expect(p.calls.at(-1)).toEqual(['hold', ['fuse', `${top.cardId}|${top.otherId}`]])
  expect(await ui.find({ text: /their hybrid hatches\. \d+ sparks\. Press 1 again in 2 s to fuse\./ })).toBeDefined()
  await press(ui, 'fuse-other')
  expect((p.state.pane.stack.at(-1) as { otherId: string | null }).otherId).toBeNull()
  await ui.unmount()
})

test('the album: families, silhouettes, a species page that crafts and wishes', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Album · Opus')!.state
  p.state = s
  p.calls = []
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(await ui.find({ text: /Discoveries · \d+\/36/ })).toBeDefined()
  await press(ui, 'album-next')
  expect(p.state.pane.album).toBe('fable')
  await press(ui, 'album-log')
  expect(p.state.pane.album).toBe('fusion')
  expect(await ui.find({ text: /Fusion Log · 1 hybrid/ })).toBeDefined()
  expect(await ui.find({ text: /×/ })).toBeDefined()
  await press(ui, 'album-next')
  expect(p.state.pane.album).toBe('haiku')
  const species = (await ui.findAll({ type: 'Button' })).find(b => String(b.key).startsWith('album-s'))!
  await press(ui, species.key!)
  expect(p.state.pane.stack.at(-1)?.kind).toBe('species')
  const craft = await ui.find({ key: 'craft-common' })
  expect(craft?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
  await press(ui, 'craft-common')
  expect(p.calls.at(-1)?.[0]).toBe('craft')
  await press(ui, 'wish')
  expect(p.calls.at(-1)?.[0]).toBe('wishlist')
  await ui.unmount()
})

test('trading: sections load on demand, offers accept, decline and counter, and gift codes are checked', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Trade · inbox')!.state
  p.state = s
  p.calls = []
  const ui = await $.ui.mount(MOUNT(120, 'terminal'))
  expect((await ui.find({ key: 'accept-offer-in-1' }))?.props.hotkey).toBe('a')
  expect((await ui.find({ key: 'accept-offer-in-2' }))?.props.hotkey).toBeUndefined()
  await press(ui, 'accept-offer-in-1')
  expect(p.calls.at(-1)).toEqual(['respond', ['offer-in-1', 'accept']])
  await press(ui, 'decline-offer-in-2')
  expect(p.calls.at(-1)).toEqual(['respond', ['offer-in-2', 'decline']])
  await press(ui, 'cancel-offer-out-1')
  expect(p.calls.at(-1)).toEqual(['hold', ['cancel-offer', 'offer-out-1']])
  expect(await ui.find({ text: /The offer to misty-lark-18 is withdrawn/ })).toBeDefined()
  await press(ui, 'counter-offer-in-1')
  const top = p.state.pane.stack.at(-1) as { kind: string; counterOf: string; give: string[]; get: string[] }
  expect(top).toMatchObject({ kind: 'profile', counterOf: 'offer-in-1' })
  expect(p.calls.at(-1)).toEqual(['profile', ['soft-otter-42']])
  expect((await ui.find({ key: 'send-offer' }))?.props).toMatchObject({ label: 'Send counter', hotkey: '1', variant: 'primary' })
  await press(ui, 'send-offer')
  expect(p.calls.at(-1)?.[0]).toBe('counter')
  await press(ui, 'tab-trade')
  await press(ui, 'community-trades')
  await press(ui, 'section-board')
  expect(p.state.pane.page).toBe(1)
  expect(p.calls.at(-1)).toEqual(['load', ['board']])
  expect(await ui.find({ key: 'match-0-offer' })).toBeDefined()
  await press(ui, 'section-trader')
  expect(p.calls.at(-1)).toEqual(['load', ['trader']])
  await press(ui, 'section-gifts')
  await type(ui, 'claim-code', 'not a code')
  expect(p.state.pane.message).toBe('A gift code looks like quiet-otter-lamp-4821.')
  await type(ui, 'claim-code', ' Quiet-Otter-Lamp-4821 ')
  expect(p.calls.at(-1)).toEqual(['claim', ['quiet-otter-lamp-4821']])
  await type(ui, 'redeem-code', 'FOUNDERS')
  expect(p.calls.at(-1)).toEqual(['redeem', ['FOUNDERS']])
  await ui.unmount()
})

test('four tabs lead to Community sections without duplicate links or pushed navigation in tiny panes', { timeoutMs: 90_000 }, async ($, on) => {
  draws(on, p)
  const base = demoSteps(NOW).find(x => x.title === 'Community · the hub')!.state
  for (const surface of SURFACES) {
    for (const columns of [24, 32, 50]) {
      p.state = base
      p.calls = []
      const ui = await $.ui.mount(MOUNT(columns, surface))
      gate(await ui.drawn(), columns, `Community @${columns} ${surface}`)
      expect((await ui.find({ key: 'tab-cards' }))?.props.label).toBe('Collection')
      expect((await ui.find({ key: 'tab-album' }))?.props.label).toBe('Discoveries')
      expect((await ui.find({ key: 'tab-trade' }))?.props.label).toBe('Community')
      expect((await ui.find({ key: 'tab-trade' }))?.props.hotkey).toBe('4')
      expect(await ui.find({ key: 'tab-market' })).toBeUndefined()
      const sectionButtons = (await ui.findAll({ type: 'Button' })).filter(b => /^community-(profile|market|boards|trades)$/.test(String(b.key)))
      expect(sectionButtons.map(b => b.props.label)).toEqual(['Profile', 'Market', 'Rankings', 'Trading'])
      expect(sectionButtons.every(b => b.props.hotkey === undefined)).toBe(true)
      expect(p.state.pane.stack.length).toBe(0)
      expect(await ui.find({ text: /rating/ })).toBeDefined()
      expect(await ui.find({ text: /sparks/ })).toBeDefined()
      expect(await ui.find({ text: /first finds/ })).toBeDefined()
      expect(await ui.find({ text: /market sales/ })).toBeDefined()
      expect(p.calls.some(([name]) => name === 'profile')).toBe(false)
      gate(await ui.drawn(), columns, `Your profile @${columns} ${surface}`)
      const links = await ui.findAll({ type: 'Link' })
      expect(links.some(l => l.props.href === `${base.account.server}/account`)).toBe(false)
      expect(links.some(l => String(l.props.href).includes('/u/'))).toBe(false)
      await press(ui, 'profile-share')
      expect(p.calls.at(-1)).toEqual(['shareProfile', []])
      expect(await ui.find({ key: 'profile-collection' })).toBeUndefined()
      expect(await ui.find({ key: 'my-profile' })).toBeUndefined()
      await press(ui, 'community-market')
      expect(p.state.pane.community).toBe('market')
      expect(p.state.pane.stack.length).toBe(0)
      gate(await ui.drawn(), columns, `Community Market @${columns} ${surface}`)
      expect(await ui.find({ key: 'market-mine' })).toBeDefined()
      const listing = (await ui.findAll({ type: 'Button' })).find(b => /^listing-.+-pick$/.test(String(b.key)))!
      await press(ui, listing.key!)
      expect(p.state.pane.stack.at(-1)?.kind).toBe('listing')
      await press(ui, 'pane-back')
      expect(p.state.pane.community).toBe('market')
      expect(p.state.pane.stack.length).toBe(0)
      await press(ui, 'community-boards')
      expect(p.state.pane.community).toBe('boards')
      expect(p.state.pane.stack.length).toBe(0)
      const boardButtons = (await ui.findAll({ type: 'Button' })).filter(b => /^board-/.test(String(b.key)))
      expect(boardButtons.length).toBe(6)
      gate(await ui.drawn(), columns, `Community Rankings @${columns} ${surface}`)
      await press(ui, 'rank-0-who')
      expect(p.state.pane.stack.at(-1)?.kind).toBe('profile')
      await press(ui, 'pane-back')
      expect(p.state.pane.community).toBe('boards')
      await press(ui, 'board-species')
      expect(p.state.pane.boards).toEqual({ board: 'species', period: 'all' })
      expect(p.calls.at(-1)).toEqual(['rankings', ['species', 'all']])
      await press(ui, 'community-trades')
      expect(p.state.pane.community).toBe('trades')
      expect(p.state.pane.stack.length).toBe(0)
      await press(ui, 'section-board')
      expect(p.calls.at(-1)).toEqual(['load', ['board']])
      gate(await ui.drawn(), columns, `Community Trading @${columns} ${surface}`)
      await press(ui, 'tab-team')
      expect(await ui.find({ key: 'team-profile' })).toBeUndefined()
      expect(await ui.find({ key: 'boards' })).toBeUndefined()
      await press(ui, 'tab-trade')
      expect(p.state.pane.community).toBe('trades')
      expect(p.state.pane.stack.length).toBe(0)
      await ui.unmount()
    }
  }
})

test('Profile shares publicly, while confirmed private browser access belongs only in Settings', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const base = demoSteps(NOW).find(x => x.title === 'Community · the hub')!.state
  const cases = [
    { world: 'online' as const, features: ['browser-account'], browser: true },
    { world: 'online' as const, features: ['passkey', 'stats'], browser: false },
    { world: 'online' as const, features: ['*'], browser: false },
    { world: 'offline' as const, features: ['browser-account'], browser: false },
  ]
  for (const surface of SURFACES) for (const c of cases) {
    p.state = { ...base, account: { ...base.account, world: c.world, features: c.features } }
    const ui = await $.ui.mount(MOUNT(24, surface))
    gate(await ui.drawn(), 24, `browser access ${c.world} ${c.features} ${surface}`)
    expect((await ui.findAll({ type: 'Link' })).filter(l => String(l.props.href).includes('/account') || String(l.props.href).includes('/u/')).length).toBe(0)
    expect(!!await ui.find({ key: 'profile-share' })).toBe(c.world === 'online')
    if (c.world === 'online') {
      await press(ui, 'profile-share')
      expect(p.calls.at(-1)).toEqual(['shareProfile', []])
    }
    await press(ui, 'profile-privacy')
    gate(await ui.drawn(), 24, `account settings ${c.world} ${c.features} ${surface}`)
    const links = (await ui.findAll({ type: 'Link' })).filter(l => String(l.props.href).endsWith('/account'))
    expect(links.length).toBe(c.browser ? 1 : 0)
    if (c.browser) {
      expect(links[0]!.props.href).toBe(base.account.server + '/account')
      expect(textOf(links[0])).toBe('Manage account')
    }
    await ui.unmount()
  }
})

test('tiny Team, Collection, Discoveries, Today and Help panes explain their icons without duplicate footer shortcuts', { timeoutMs: 90_000 }, async ($, on) => {
  draws(on, p)
  const steps = demoSteps(NOW)
  for (const title of ['Team · the daily hello', 'Team · a brand-new player', 'Team · slots, resting, notices with Revenge', 'Cards · the collection', 'Album · Opus', 'Today · the meadow rule', 'Help · the field guide']) {
    for (const surface of SURFACES) {
      for (const columns of [24, 32]) {
        p.state = steps.find(s => s.title === title)!.state
        const ui = await $.ui.mount(MOUNT(columns, surface))
        const tree = await ui.drawn()
        gate(tree, columns, `${title} @${columns} ${surface}`)
        const footer = textOf((tree as Node).children!.at(-1))
        expect(/Tabs|Pick a card|Next page|Open pack/.test(footer)).toBe(false)
        expect(await ui.find({ key: 'pane-back' })).toBeDefined()
        await ui.unmount()
      }
    }
  }
  p.state = steps.find(s => s.title === 'Team · slots, resting, notices with Revenge')!.state
  const ui = await $.ui.mount(MOUNT(32, 'terminal'))
  await press(ui, 'today')
  expect(p.state.pane.stack.at(-1)?.kind).toBe('today')
  expect(await ui.find({ text: /midnight UTC/ })).toBeDefined()
  expect((await ui.find({ key: 'pane-help' }))?.props).toMatchObject({ label: '? Help' })
  expect((await ui.find({ key: 'pane-help' }))?.props.hotkey).toBeUndefined()
  await press(ui, 'pane-help')
  expect(p.state.pane.stack.at(-1)?.kind).toBe('help')
  expect(await ui.find({ text: /Families are creature types/ })).toBeDefined()
  expect(await ui.find({ text: /First Discovered means the first trainer globally/ })).toBeDefined()
  await ui.unmount()
})

test('older Market tabs and profile, ranking and trading views remain readable in Community', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const base = demoSteps(NOW).find(x => x.title === 'Community · your profile')!.state
  const oldStates: { patch: Partial<GameState['pane']>; control: string }[] = [
    { patch: { tab: 'market', community: undefined }, control: 'market-mine' },
    { patch: { tab: 'team', community: undefined, stack: [{ kind: 'mine' }] }, control: 'profile-privacy' },
    { patch: { tab: 'trade', community: undefined, stack: [{ kind: 'trades' }] }, control: 'section-inbox' },
    { patch: { tab: 'team', community: undefined, stack: [{ kind: 'boards', board: 'rating', period: 'all' }] }, control: 'board-rating' },
  ]
  for (const old of oldStates) {
    p.state = { ...base, pane: { ...base.pane, ...old.patch } }
    const ui = await $.ui.mount(MOUNT(24, 'terminal'))
    gate(await ui.drawn(), 24, `legacy ${old.control}`)
    expect(await ui.find({ key: old.control })).toBeDefined()
    expect(await ui.find({ key: 'tab-market' })).toBeUndefined()
    await press(ui, 'community-profile')
    expect(p.state.pane).toMatchObject({ tab: 'trade', community: 'profile', stack: [] })
    await ui.unmount()
  }
})

test('the offer builder picks up to three cards a side and sends only with one of yours', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Trade · a profile and an offer being built')!.state
  p.state = { ...s, pane: { ...s.pane, stack: [{ kind: 'profile', handle: 'soft-otter-42', give: [], get: [], counterOf: null }] } }
  p.calls = []
  const ui = await $.ui.mount(MOUNT(80, 'desktop'))
  expect(await ui.find({ key: 'send-offer' })).toBeUndefined()
  const mine = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('mine-'))
  for (const b of mine.slice(0, 4)) await press(ui, b.key!)
  const top = p.state.pane.stack.at(-1) as { give: string[] }
  expect(top.give.length).toBe(3)
  await press(ui, 'send-offer')
  expect(p.calls.at(-1)?.[0]).toBe('offer')
  expect((p.calls.at(-1)?.[1] as unknown[])[0]).toBe('soft-otter-42')
  await ui.unmount()
})

test('privacy shows what is read and sent, never the token, and deletes only behind a hold', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Privacy · online')!.state
  p.state = s
  p.calls = []
  for (const surface of SURFACES) {
    p.state = s
    const ui = await $.ui.mount(MOUNT(80, surface))
    expect(await ui.find({ text: /Never your prompts, Claude's answers, files, commands, paths or cost/ })).toBeDefined()
    expect(await ui.find({ text: /POST \/v1\/packs\/charge/ })).toBeDefined()
    expect(await ui.find({ text: /Hooks: session\.start/ })).toBeDefined()
    expect(await ui.find({ text: /tool\.call|prompt\.submit/ })).toBeUndefined()
    expect((await ui.find({ key: 'passkey-add' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
    await press(ui, 'delete-account')
    expect(p.calls.at(-1)).toEqual(['hold', ['delete-account', 'me']])
    expect(await ui.find({ text: /are gone for good\. Press x again in 2 s to delete\./ })).toBeDefined()
    await ui.unmount()
  }
  p.state = demoSteps(NOW).find(x => x.title === 'Offline · privacy')!.state
  const ui = await $.ui.mount(MOUNT(50, 'terminal'))
  expect(await ui.find({ key: 'delete-account' })).toBeUndefined()
  expect(await ui.find({ key: 'reset-access' })).toBeUndefined()
  expect(await ui.find({ key: 'delete-offline' })).toBeDefined()
  expect(await ui.find({ text: /the offline world never sends a request/ })).toBeDefined()
  await ui.unmount()
})

test('devices: a passkey page shows only on the server\'s own origin', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const s = demoSteps(NOW).find(x => x.title === 'Devices · a passkey page open')!.state
  p.state = s
  let ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  expect(await ui.find({ text: /Signed in on 2 devices · no passkey yet/ })).toBeDefined()
  // reset access removes saved passkeys too (SPEC 30): the copy never promises they stay
  expect(await ui.find({ text: /removes saved passkeys/ })).toBeDefined()
  expect(await ui.find({ text: /Passkeys stay/ })).toBeUndefined()
  await ui.unmount()
  p.state = { ...s, account: { ...s.account, signIn: { ...s.account.signIn!, url: 'https://evil.example/passkey/add' } } }
  ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.find({ text: /evil\.example/ })).toBeUndefined()
  expect(await ui.find({ text: /not on this server/ })).toBeDefined()
  await ui.unmount()
})

test('offline: trading with players is one line away, the Trader still deals', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  p.state = demoSteps(NOW).find(x => x.title === 'Offline · the Trade tab')!.state
  p.calls = []
  const ui = await $.ui.mount(MOUNT(50, 'terminal'))
  expect(await ui.find({ text: /needs the online world/ })).toBeDefined()
  expect(await ui.find({ key: 'section-inbox' })).toBeUndefined()
  await press(ui, 'join-online')
  expect(p.calls.at(-1)).toEqual(['world', ['online']])
  expect(await ui.find({ text: /The Wandering Trader/ })).toBeDefined()
  expect(await ui.find({ text: /Offline/ })).toBeDefined()
  await ui.unmount()
})

test('/spin demo steps through every state over inert actions', { timeoutMs: 60_000 }, async ($, on) => {
  draws(on, p)
  const base = demoSteps(NOW)[0]!.state
  p.state = { ...base, pane: { ...base.pane, stack: [{ kind: 'demo', step: 0 }] } }
  p.calls = []
  const ui = await $.ui.mount(MOUNT(80, 'terminal'))
  expect(await ui.find({ text: /^Demo 1\/\d+ · Team · the daily hello$/ })).toBeDefined()
  await press(ui, 'demo-next')
  expect(p.state.pane.stack).toEqual([{ kind: 'demo', step: 1 }])
  await press(ui, 'demo-prev')
  await press(ui, 'demo-prev')
  expect((p.state.pane.stack[0] as { step: number }).step).toBe(demoSteps(NOW).length - 1)
  // the last steps are band moments; the first is a pane screen with tabs to press
  await press(ui, 'demo-next')
  const before = p.calls.length
  await press(ui, 'tab-cards')
  expect(p.calls.length).toBe(before)
  gate(await ui.drawn(), 80, 'demo')
  await ui.unmount()
})

test('view models: team places, trader picks, filters, pages, reveal words', () => {
  const steps = demoSteps(NOW)
  const s = steps.find(x => x.title === 'Team · slots, resting, notices with Revenge')!.state
  const me = s.me!
  const outsider = s.cards.find(c => !me.player.team.includes(c.id) && c.rarity === 'legendary')!
  const place = teamPlace(me.player.team, outsider, s.cards)
  expect(place.kind).toBe('replace')
  expect(teamPlace(me.player.team, s.cards.find(c => c.id === me.player.team[0])!, s.cards).kind).toBe('leads')
  expect(teamPlace(me.player.team, s.cards.find(c => c.id === me.player.team[2])!, s.cards)).toMatchObject({ kind: 'lead' })
  expect(teamPlace([], outsider, s.cards)).toEqual({ kind: 'add', ids: [outsider.id] })
  expect(bestTeam(s.cards)).toHaveLength(3)
  expect(bestTeam(s.cards)).toContain(outsider.id)
  const starter = s.cards.find(c => c.bound)!
  expect(cardCan(starter, { offline: false, now: NOW, market: true })).toMatchObject({ trade: false, gift: false, sell: false, recycle: false, fuse: false })
  expect(cardCan(outsider, { offline: true, now: NOW, market: true })).toMatchObject({ trade: false, gift: false, sell: false, recycle: true })
  // no account limits: any online card free to trade trades, gifts and sells from the first day, with nothing to wait on
  expect(cardCan(outsider, { offline: false, now: NOW, market: true })).toMatchObject({ trade: true, gift: true, sell: true, tradeNote: '' })
  expect(cardCan(outsider, { offline: false, now: NOW })).toMatchObject({ sell: false })
  for (const deal of traderDeals(NOW)) {
    const picks = traderPicks(deal, s.cards, me.player.team, NOW)
    if (!picks) continue
    expect(picks).toHaveLength(deal.give.count)
    for (const c of picks) {
      expect(me.player.team.includes(c.id) || c.bound || c.shiny || !!c.foil || c.forTrade).toBe(false)
      if (deal.give.family) expect(c.family).toBe(deal.give.family)
      if (deal.give.rarity) expect(c.rarity).toBe(deal.give.rarity)
    }
  }
  expect(collection(s.cards, 'opus', 'all').every(c => c.family === 'opus')).toBe(true)
  expect(paged([1, 2, 3, 4, 5], 9, 2)).toEqual({ items: [5], page: 2, pages: 3 })
  expect(tradeSection(2, false)).toBe('trader')
  expect(tradeSection(0, true)).toBe('trader')
  const pack = steps.find(x => x.title === 'Pack · the summary')!.state.reveal!
  expect(revealSummary(pack)).toBe('2 cards · 2 new species · Album 14/36 (+2)')
  expect(holdText('recycle', outsider.id, s, NOW)).toMatch(/will be gone\. You get \d+ sparks\./)
  expect(holdText('reset-access', 'me', s, NOW)).toBe('Other machines sign out and saved passkeys are removed.')
  // one of a thing reads as one: "1 first", "1 Mythic"
  const stats = { duelWins: 0, duelLosses: 0, playersBeaten: 0, wildWins: 0, catches: 0, speciesCollected: 0, firstFinds: 1, mythicsFound: 1, marketSales: 0 }
  expect(statTiles(stats).filter(t => t.key === 'firsts' || t.key === 'mythics').map(t => `${t.value} ${t.label}`)).toEqual(['1 first', '1 Mythic'])
  expect(statTiles({ ...stats, firstFinds: 2, mythicsFound: 3 }).filter(t => t.key === 'firsts' || t.key === 'mythics').map(t => `${t.value} ${t.label}`)).toEqual(['2 firsts', '3 Mythics'])
})

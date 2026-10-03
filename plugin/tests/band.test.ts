// The band's quality gate (SPEC 21): every band state mounts on the terminal and the desktop at 40, 80 and 120
// columns with no refused tree, no overflow, at most four rows, art wherever art belongs, and every button on a digit
// (the only keys an empty prompt hands the band), the primary one on 1. Then each state's own words and presses.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { BattleLog, Card, Family, Rarity } from '../hooks/core/types.ts'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../hooks/core/battle.ts'
import { mintCard, toBattleCard } from '../hooks/core/cards.ts'
import { generateMythic } from '../hooks/core/mythics.ts'
import { familySpecies, legendaryOf } from '../hooks/core/species.ts'
import { seasonOf } from '../hooks/core/world.ts'
import { EVOLVE_SHOW, catchPreMs } from '../hooks/client/battleview.ts'
import { INITIAL } from '../hooks/client/game.ts'
import type { Actions, BandState, Battle, El, Moment, Outcome } from '../hooks/client/types.ts'
import { band } from '../hooks/ui/band.tsx'
import { NOW, meFor } from './fixtures.ts'

// ---------- fixtures ----------

const SEASON = seasonOf(NOW)
let serial = 0

function mint(family: Family, index: number, o: { rarity?: Rarity; shiny?: boolean; level?: number } = {}): Card {
  const species = index === 8 ? legendaryOf(SEASON, family) : familySpecies(SEASON, family).filter(s => !s.legendary)[index]!
  const card = mintCard({ species, rarity: o.rarity ?? (index === 8 ? 'legendary' : 'common'), shiny: o.shiny ?? false, dna: 4242 + serial, origin: 'pack', now: NOW, level: o.level ?? 3 })
  return { ...card, id: `card-${++serial}` }
}

const team = [mint('opus', 0, { level: 4 }), mint('sonnet', 1), mint('haiku', 2)]
const wild = {
  common: mint('haiku', 3), rare: mint('haiku', 4, { rarity: 'rare' }), epic: mint('fable', 5, { rarity: 'epic' }),
  shiny: mint('sonnet', 6, { shiny: true }), roamer: mint('fable', 8),
  mythic: { ...generateMythic({ seed: 'band-mythic', dna: 9, now: NOW }), id: 'mythic-1' } as Card,
}
const rivals = [mint('opus', 6), mint('fable', 1)]

function battle(o: Partial<Pick<Battle, 'phase' | 'shown' | 'inputs' | 'live' | 'log'>> & { kind?: 'wild' | 'duel'; defender?: Card[]; first?: boolean } = {}): Battle {
  const kind = o.kind ?? 'wild'
  const defender = (o.defender ?? (kind === 'duel' ? rivals : [wild.common])).map(toBattleCard)
  return {
    id: `battle-${++serial}`, setup: { seed: 'band-seed', kind, arena: 'opus', rule: 'calm', rules: RULES_VERSION, attacker: team.map(toBattleCard), defender },
    opponent: kind === 'duel' ? { kind: 'rival', name: 'Thistlewick', league: 'Pebble' } : { kind: 'wild' },
    subs: [], firstPossible: defender.map(() => !!o.first), startedAt: NOW, finishAfter: NOW,
    live: o.live ?? true, phase: o.phase ?? 'fight', shown: o.shown ?? 0, inputs: o.inputs ?? [], log: o.log ?? null,
  }
}

const duelLog = simulateBattle(battle({ kind: 'duel' }).setup, []) as BattleLog
const perfectAt = perfectRounds(duelLog)[0] ?? 2

function base(): BandState {
  return {
    account: { ...INITIAL.account, link: 'ready' }, me: { ...meFor(NOW, team, 'opus'), player: { ...meFor(NOW, team, 'opus').player, streak: 2 } },
    cards: [...team], signals: { ...INITIAL.signals, family: 'opus' }, battle: null, moments: [], prefs: { quiet: false, motion: true, sound: false },
  }
}

function outcome(o: Partial<Outcome> = {}): Outcome {
  return {
    battleId: 'battle-band', kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(wild.common), result: 'win', sparks: 10, rating: 1000,
    ratingDelta: 0, league: null, perfect: 0, xp: [], catch: { status: 'none' }, bounty: null, dailyWinPack: false, streak: 1, streakPack: false, ...o,
  }
}

const caughtCard = { ...wild.rare, id: 'caught-1', origin: 'catch' } as Card

type Fixture = { name: string; state: BandState; now?: number; art?: boolean; texts?: RegExp[]; keys?: string[]; none?: boolean }

const at = (state: Partial<BandState>): BandState => ({ ...base(), ...state })
const moment = (m: Moment, extra: Partial<BandState> = {}): BandState => at({ moments: [m], ...extra })

const FIXTURES: Fixture[] = [
  { name: 'hatching while joining', state: at({ me: null, cards: [], account: { ...INITIAL.account, link: 'joining' } }), art: true, texts: [/Something is hatching…/] },
  { name: 'welcome', state: moment({ kind: 'welcome', id: 'welcome', packId: 'pack-welcome-1', until: null }), art: true, texts: [/A Spinling hatched!/], keys: ['act-welcome', 'dismiss-welcome'] },
  { name: 'rustle common', state: at({ battle: battle({ phase: 'rustle' }) }), art: true, texts: [/Something is rustling…/, /Opus arena/] },
  { name: 'rustle rare', state: at({ battle: battle({ phase: 'rustle', defender: [wild.rare] }) }), art: true, texts: [/Something is rustling…/] },
  { name: 'rustle epic', state: at({ battle: battle({ phase: 'rustle', defender: [wild.epic] }) }), art: true, texts: [/Something is rustling…/] },
  { name: 'rustle shiny', state: at({ battle: battle({ phase: 'rustle', defender: [wild.shiny] }) }), art: true, texts: [/Something is rustling…/] },
  { name: 'rustle roamer', state: at({ battle: battle({ phase: 'rustle', defender: [wild.roamer] }) }), art: true, texts: [/The air feels different…/] },
  { name: 'rustle mythic', state: at({ battle: battle({ phase: 'rustle', defender: [wild.mythic] }) }), art: true, texts: [/Something strange stirs…/] },
  { name: 'duel call', state: at({ battle: battle({ kind: 'duel', phase: 'rustle' }) }), art: true, texts: [/Rival Thistlewick wants to battle!/] },
  { name: 'reveal new, first in the world', state: at({ battle: battle({ phase: 'reveal', first: true, defender: [wild.epic, wild.common] }) }), art: true, texts: [/A wild .+ appeared!/, /NEW/, /FIRST IN THE WORLD\?/, /and 1 more/] },
  { name: 'reveal mythic', state: at({ battle: battle({ phase: 'reveal', defender: [wild.mythic] }) }), art: true, texts: [/A Mythic appeared!/, /Mythic/] },
  { name: 'reveal duel', state: at({ battle: battle({ kind: 'duel', phase: 'reveal' }) }), art: true, texts: [/Rival Thistlewick sent out .+!/] },
  { name: 'fight: the special is ready', state: at({ battle: battle({ kind: 'duel', shown: perfectAt - 1 }), signals: { ...INITIAL.signals, cheering: 2 } }), art: true, texts: [/vs Rival Thistlewick/, /is ready!/], keys: ['now'] },
  { name: 'fight: Perfect pressed', state: at({ battle: battle({ kind: 'duel', shown: perfectAt - 1, inputs: [perfectAt] }) }), art: true, texts: [/Perfect!/] },
  { name: 'fight: a quiet round, the streak', state: at({ battle: battle({ kind: 'duel', shown: 0 }) }), art: true, texts: [/round 1/] },
  { name: 'fight: the server log is on its way', state: at({ battle: battle({ kind: 'duel', live: false }) }), art: true, texts: [/Sizing each other up…/] },
  { name: 'fight: counting up', state: at({ battle: battle({ kind: 'duel', phase: 'finishing', shown: duelLog.rounds.length }) }), art: true, texts: [/Counting up…/] },
  {
    name: 'catch choice', art: true, texts: [/Pick one to keep/, /in 20 s if you look away/], keys: ['catch-0', 'catch-1', 'catch-2'],
    state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 20_000, outcome: outcome({ catch: { status: 'choose', options: [wild.common, wild.rare, wild.epic].map(toBattleCard), deadline: NOW + 20_000 } }) }),
  },
  { name: 'catching, server pending', state: moment({ kind: 'outcome', id: 'outcome:b', until: null, outcome: outcome({ catch: { status: 'catching', options: [toBattleCard(wild.rare)], index: 0 } }) }), art: true, texts: [/Catching .+…/] },
  { name: 'caught, wobbling still', now: NOW + 100, state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ catch: { status: 'caught', card: caughtCard } }) }), art: true, texts: [/Catching .+…/] },
  { name: 'caught', now: NOW + catchPreMs(caughtCard) + 10, state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ catch: { status: 'caught', card: caughtCard }, dailyWinPack: true }) }), art: true, texts: [/Gotcha! .+ joined your collection/, /Won vs wild/, /Rare/, /First win today/], keys: ['act-outcome:b'] },
  { name: 'slipped', now: NOW + 9000, state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ catch: { status: 'slipped' } }) }), art: true, texts: [/It slipped away!/] },
  { name: 'mythic fled', state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ result: 'loss', sparks: 3, lead: toBattleCard(wild.mythic), catch: { status: 'fled' } }) }), art: true, texts: [/It vanished into the static/, /Nobody will ever see it again/] },
  {
    name: 'duel won: streak pack, league, perfects, daily pack, bounty', art: true,
    texts: [/Won vs Rival Thistlewick · \+12 sparks · rating \+14/, /Hot streak! x3/, /Grove league!/, /Perfect x2/],
    state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ kind: 'duel', opponent: { kind: 'rival', name: 'Thistlewick', league: 'Brook' }, sparks: 12, rating: 1305, ratingDelta: 14, league: { from: 'Brook', to: 'Grove' }, perfect: 2, streak: 3, streakPack: true, dailyWinPack: true, bounty: { ...wild.epic, id: 'bounty-1' } }) }),
  },
  { name: 'wild lost', state: moment({ kind: 'outcome', id: 'outcome:b', until: NOW + 12_000, outcome: outcome({ result: 'loss', sparks: 3 }) }), art: true, texts: [/Lost to wild .+ · \+3 sparks/] },
  { name: 'evolving', now: NOW + 500, state: moment({ kind: 'evolve', id: 'evolve:x:2', cardId: team[0]!.id, from: 'Before', to: 'After', stage: 2, until: NOW + EVOLVE_SHOW }), art: true, texts: [/What\? Before is evolving!/] },
  { name: 'evolved', now: NOW + 4000, state: moment({ kind: 'evolve', id: 'evolve:x:2', cardId: team[0]!.id, from: 'Before', to: 'After', stage: 2, until: NOW + EVOLVE_SHOW }), art: true, texts: [/Before evolved into After!/, /HP \+\d+/], keys: ['act-evolve:x:2'] },
  { name: 'pack ready', state: moment({ kind: 'pack-ready', id: 'pack-ready', count: 3, until: NOW + 6000 }), art: true, texts: [/A pack is ready!/, /3 packs waiting/], keys: ['act-pack-ready'] },
  { name: 'present', state: moment({ kind: 'present', id: 'present:n1', from: 'quiet-otter-42', cardIds: [], until: null }), art: true, texts: [/quiet-otter-42 sent you a gift!/], keys: ['act-present:n1'] },
  { name: 'update', state: moment({ kind: 'update', id: 'update:0.2.0', version: '0.2.0', until: null }), texts: [/Spinlings 0.2.0 is out/, /claude plugin update spinlings@spinlings/], keys: ['act-update:0.2.0'] },
  { name: 'passkey offer', state: moment({ kind: 'passkey', id: 'passkey', until: null }), texts: [/Save your collection with a passkey/, /no email, no password/, /losing this computer loses your online cards/], keys: ['act-passkey', 'dismiss-passkey'] },
  { name: 'needs online', state: moment({ kind: 'needs-online', id: 'needs-online', until: NOW + 9000 }), texts: [/This needs the online world/], keys: ['act-needs-online', 'dismiss-needs-online'] },
  { name: 'community server', state: moment({ kind: 'server', id: 'server:https://cats.example', origin: 'https://cats.example', until: null }), texts: [/cats.example is a community server run by someone else/], keys: ['act-server:https://cats.example'] },
  { name: 'offline fallback', state: moment({ kind: 'line', id: 'line:notice:x', tone: 'notice', text: 'Playing offline · /spin world online when you\'re connected', until: NOW + 15_000 }), texts: [/Playing offline · \/spin world online when you're connected/] },
  { name: 'first-run hint', state: moment({ kind: 'line', id: 'line:hint:x', tone: 'hint', text: 'Creatures find you while Claude works · /spin to open your collection', until: NOW + 10_000 }), texts: [/Creatures find you while Claude works/] },
  { name: 'reaction', state: moment({ kind: 'line', id: 'line:reaction:x', tone: 'reaction', text: 'Pipkin flinched', until: NOW + 4000 }), texts: [/Pipkin flinched/] },
  { name: 'quiet hides a welcome', state: moment({ kind: 'welcome', id: 'welcome', packId: null, until: null }, { prefs: { quiet: true, motion: true, sound: false } }), none: true },
  { name: 'quiet still shows your own battle, still', state: at({ battle: battle({ kind: 'duel', shown: 1 }), prefs: { quiet: true, motion: true, sound: false } }), art: true, texts: [/vs Rival Thistlewick/] },
  { name: 'motion off', state: at({ battle: battle({ phase: 'rustle', defender: [wild.mythic] }), prefs: { quiet: false, motion: false, sound: false } }), art: true, texts: [/Something strange stirs…/] },
  { name: 'nothing live', state: at({}), none: true },
]

// ---------- the band view, drawn beneath the plugins as register.tsx's BAND slot draws it ----------

let current: { state: BandState; now: number } = { state: base(), now: NOW }
const calls: [string, unknown[]][] = []
const actions = new Proxy({}, { get: (_t, k) => (...args: unknown[]) => { calls.push([String(k), args]); return Promise.resolve() } }) as Actions

/** The band from this file's fixture (an inline plugin cannot close over this file's imports); null draws the engine's. */
function draws(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => band({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns, rows: e.props.maxRows,
    now: current.now, actions, isWorking: e.props.isWorking, state: current.state,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
}

const LONG = { timeoutMs: 120_000 }
const MOUNT = { plugin: 'spinlings', component: 'AbovePrompt', requestId: 'band' } as const

const props = (columns: number, maxRows = 8) => ({ hasSurvey: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} })

// ---------- measuring a drawn tree (the terminal's cells) ----------

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && typeof (n as Node).type === 'string'

function textOf(n: unknown): string {
  if (typeof n === 'string') return n
  if (typeof n === 'number') return String(n)
  if (!isNode(n)) return ''
  return (n.children ?? []).map(textOf).join('')
}

/** The least width and the rows a node takes in a cell grid, `avail` cells across. Overflow lands in `problems`. */
function measure(n: unknown, avail: number, problems: string[]): { w: number; h: number } {
  if (typeof n === 'string') return { w: [...n].length, h: 1 }
  if (!isNode(n)) return { w: 0, h: 0 }
  const p = n.props ?? {}
  const kids = n.children ?? []
  switch (n.type) {
    case 'Raster': return { w: Number(p.columns), h: Number(p.rows) }
    case 'Svg': return { w: 0, h: 0 }
    case 'Button': {
      const label = String(p.label ?? textOf(n))
      return { w: [...label].length + (p.hotkey ? String(p.hotkey).length + 2 : 4), h: 1 }
    }
    case 'Text': {
      const s = textOf(n)
      const len = [...s].length
      const wrap = String(p.wrap ?? 'wrap')
      if (wrap.startsWith('truncate')) return { w: Math.min(len, 1), h: 1 }
      const word = Math.max(0, ...s.split(/\s+/).map(x => [...x].length))
      return { w: word, h: Math.max(1, Math.ceil(len / Math.max(1, avail))) }
    }
    case 'Box': {
      if (p.display === 'none') return { w: 0, h: 0 }
      const width = typeof p.width === 'number' ? p.width : null
      const inner = width ?? avail
      const row = String(p.flexDirection ?? 'row').startsWith('row')
      const gap = Number(row ? p.columnGap ?? p.gap ?? 0 : p.rowGap ?? p.gap ?? 0)
      const parts = kids.map(k => measure(k, inner, problems)).filter(x => x.w > 0 || x.h > 0)
      let w: number, h: number
      if (row && p.flexWrap === 'wrap') {
        w = Math.max(0, ...parts.map(x => x.w))
        const total = parts.reduce((s, x) => s + x.w, 0) + gap * Math.max(0, parts.length - 1)
        h = Math.max(1, Math.ceil(total / Math.max(1, inner))) * Math.max(1, ...parts.map(x => x.h))
      } else if (row) {
        w = parts.reduce((s, x) => s + x.w, 0) + gap * Math.max(0, parts.length - 1)
        h = Math.max(0, ...parts.map(x => x.h))
      } else {
        w = Math.max(0, ...parts.map(x => x.w))
        h = parts.reduce((s, x) => s + x.h, 0) + gap * Math.max(0, parts.length - 1)
      }
      if (width !== null && w > width) problems.push(`a ${row ? 'row' : 'column'} needs ${w} cells inside width ${width}`)
      return { w: width ?? w, h }
    }
    default: return { w: textOf(n).length, h: 1 }
  }
}

function walk(n: unknown, out: Node[] = []): Node[] {
  if (!isNode(n)) return out
  out.push(n)
  for (const k of n.children ?? []) walk(k, out)
  return out
}

// ---------- the gate ----------

for (const surface of ['terminal', 'desktop'] as const) {
  test(`every band state draws on the ${surface} at 40, 80 and 120 columns`, LONG, async ($, on) => {
    draws(on)
    for (const f of FIXTURES) {
      for (const columns of [40, 80, 120]) {
        current = { state: f.state, now: f.now ?? NOW }
        const where = `${f.name} at ${columns} on the ${surface}`
        let ui
        try {
          ui = await $.ui.mount({ ...MOUNT, surface, props: props(columns) })
        } catch (err) {
          throw new Error(`${where}: refused: ${String(err)}`)
        }
        const tree = await ui.drawn()
        if (f.none) {
          expect(textOf(tree)).toBe('engine band')
          await ui.unmount()
          continue
        }
        const nodes = walk(tree)
        if (surface === 'terminal') {
          const problems: string[] = []
          const size = measure(tree, columns, problems)
          if (size.w > columns) problems.push(`needs ${size.w} cells`)
          if (size.h > 4) problems.push(`takes ${size.h} rows`)
          expect(`${where}: ${problems.join('; ') || 'fits'}`).toBe(`${where}: fits`)
        }
        for (const b of nodes.filter(x => x.type === 'Button')) {
          expect(`${where}: ${String(b.props?.label)} on ${String(b.props?.hotkey)}`).toMatch(/ on [1-9]$/)
          if (b.props?.variant === 'primary') expect(`${where}: primary on ${String(b.props.hotkey)}`).toBe(`${where}: primary on 1`)
        }
        if (f.art) {
          const kind = surface === 'terminal' ? 'Raster' : 'Svg'
          expect(`${where}: ${nodes.filter(x => x.type === kind).length > 0 ? 'art' : 'no art'}`).toBe(`${where}: art`)
        }
        for (const text of f.texts ?? []) {
          const found = await ui.find({ text })
          expect(`${where}: ${found ? 'shows' : 'lacks'} ${String(text)}`).toBe(`${where}: shows ${String(text)}`)
        }
        for (const key of f.keys ?? []) expect(`${where}: ${(await ui.find({ key })) ? 'has' : 'lacks'} ${key}`).toBe(`${where}: has ${key}`)
        await ui.unmount()
      }
    }
  })
}

test('the battle band: both creatures at 80 and up, the defender and two stat lines below that', LONG, async ($, on) => {
  draws(on)
  current = { state: at({ battle: battle({ kind: 'duel', shown: 1 }) }), now: NOW }
  for (const [columns, keys] of [[120, ['band-a', 'band-d']], [80, ['band-a', 'band-d']], [40, ['band-d-art', 'band-a-line', 'band-d-line']]] as const) {
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(columns) })
    const rasters = (await ui.findAll({ type: 'Raster' })).map(r => r.key)
    expect(rasters).toEqual([...keys])
    await ui.unmount()
  }
  const desk = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(80) })
  expect((await desk.findAll({ type: 'Svg' })).length).toBe(2)
  expect((await desk.findAll({ type: 'Svg' })).every(s => s.props.isInteractive === true)).toBe(true)
  await desk.unmount()
  current = { state: at({ battle: battle({ kind: 'duel', shown: 1 }), prefs: { quiet: false, motion: false, sound: false } }), now: NOW }
  const still = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(80) })
  expect((await still.findAll({ type: 'Svg' })).some(s => s.props.isInteractive === true)).toBe(false)
  await still.unmount()
})

test('band presses reach the game: Now!, a catch pick, the primary and the secondary', LONG, async ($, on) => {
  draws(on)
  const press = async (state: BandState, key: string, now = NOW) => {
    current = { state, now }
    calls.length = 0
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(80) })
    await ui.press({ key, plugin: 'test' })
    await ui.unmount()
    return calls.slice()
  }
  expect(await press(at({ battle: battle({ kind: 'duel', shown: perfectAt - 1 }) }), 'now')).toEqual([['press', []]])
  const choose = FIXTURES.find(f => f.name === 'catch choice')!.state
  expect(await press(choose, 'catch-2')).toEqual([['pickCatch', [2]]])
  expect(await press(choose, 'catch-0')).toEqual([['pickCatch', [0]]])
  const welcome = FIXTURES.find(f => f.name === 'welcome')!.state
  expect(await press(welcome, 'act-welcome')).toEqual([['act', ['welcome']]])
  expect(await press(welcome, 'dismiss-welcome')).toEqual([['dismiss', ['welcome']]])
})

test('the catch keeps its secret until the beats are over, and motion off tells at once', LONG, async ($, on) => {
  draws(on)
  const caught = FIXTURES.find(f => f.name === 'caught, wobbling still')!.state
  const read = async (state: BandState, now: number) => {
    current = { state, now }
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(80) })
    const text = textOf(await ui.drawn())
    await ui.unmount()
    return text
  }
  const pre = catchPreMs(caughtCard)
  expect(await read(caught, NOW - 30_000)).not.toMatch(/Gotcha/)
  expect(await read(caught, NOW + pre - 50)).not.toMatch(/Gotcha/)
  expect(await read(caught, NOW + pre + 50)).toMatch(/Gotcha!/)
  expect(await read({ ...caught, prefs: { quiet: false, motion: false, sound: false } }, NOW + 10)).toMatch(/Gotcha!/)
})

test('the catch choice offers the rarest first: 1, the primary, is also the one kept if you look away', LONG, async ($, on) => {
  draws(on)
  current = { state: FIXTURES.find(f => f.name === 'catch choice')!.state, now: NOW }
  for (const columns of [40, 120]) {
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(columns) })
    // the options came common, rare, epic: the epic (the server's 2) is on 1
    expect((await ui.find({ key: 'catch-2' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
    expect((await ui.find({ key: 'catch-1' }))?.props).toMatchObject({ hotkey: '2' })
    expect((await ui.find({ key: 'catch-0' }))?.props).toMatchObject({ hotkey: '3' })
    await ui.unmount()
  }
})

test('a window under four rows: every band state fits it, the action first, so its digit always reaches it', LONG, async ($, on) => {
  draws(on)
  for (const f of FIXTURES.filter(x => !x.none)) {
    for (const maxRows of [2, 3]) {
      for (const columns of [40, 80, 120]) {
        current = { state: f.state, now: f.now ?? NOW }
        const where = `${f.name} at ${columns} in ${maxRows} rows`
        const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(columns, maxRows) })
        const tree = await ui.drawn()
        const problems: string[] = []
        const size = measure(tree, columns, problems)
        if (size.w > columns) problems.push(`needs ${size.w} cells`)
        if (size.h > maxRows) problems.push(`takes ${size.h} rows`)
        expect(`${where}: ${problems.join('; ') || 'fits'}`).toBe(`${where}: fits`)
        for (const key of f.keys ?? []) expect(`${where}: ${(await ui.find({ key })) ? 'has' : 'lacks'} ${key}`).toBe(`${where}: has ${key}`)
        await ui.unmount()
      }
    }
  }
})

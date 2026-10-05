// The band's quality gate (SPEC 21): every band state mounts on the terminal and the desktop at 40, 80 and 120
// columns with no refused tree, four terminal rows or the advertised Desktop budget, and art wherever it fits.
// Every button uses a digit (the only keys an empty prompt hands the band), the primary one on 1.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { BattleLog, Card, Family, Rarity } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { mintCard, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { familySpecies, legendaryOf } from '../../plugin/hooks/core/species.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import { EVOLVE_SHOW, catchPreMs } from '../../plugin/hooks/client/battleview.ts'
import { INITIAL } from '../../plugin/hooks/client/game.ts'
import type { Actions, BandState, Battle, El, Moment, Outcome } from '../../plugin/hooks/client/types.ts'
import { band } from '../../plugin/hooks/ui/band.tsx'
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
const CATS: Moment = { kind: 'server', id: 'server:https://cats.example', origin: 'https://cats.example', until: null }

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
  { name: 'passkey offer', state: moment({ kind: 'passkey', id: 'passkey', until: null }), texts: [/Your cards live only on this computer/, /no email, no password/], keys: ['act-passkey', 'dismiss-passkey'] },
  { name: 'passkey offer at a catch worth keeping', state: moment({ kind: 'passkey', id: 'passkey', until: null, card: wild.epic }), art: true, texts: [/lives only on this computer/, /no email, no password/], keys: ['act-passkey', 'dismiss-passkey'] },
  { name: 'sold on the market', state: moment({ kind: 'market', id: 'market:n9', outcome: 'sold', card: wild.epic, handle: 'misty-lark-18', price: 1250, until: NOW + 15_000 }), art: true, texts: [/Sold!/, /went to misty-lark-18/, /\+✧ 1,250/], keys: ['act-market:n9'] },
  { name: 'a listing came home', state: moment({ kind: 'market', id: 'market:n8', outcome: 'expired', card: wild.common, handle: null, price: 0, until: NOW + 15_000 }), art: true, texts: [/came home from the market/], keys: ['act-market:n8'] },
  { name: 'needs online', state: moment({ kind: 'needs-online', id: 'needs-online', until: NOW + 9000 }), texts: [/This needs the online world/], keys: ['act-needs-online', 'dismiss-needs-online'] },
  { name: 'community server', state: moment({ kind: 'server', id: 'server:https://cats.example', origin: 'https://cats.example', until: null }), texts: [/cats.example is a community server run by someone else/], keys: ['act-server:https://cats.example'] },
  { name: 'community server in use (the Server URL option)', state: moment(CATS, { account: { ...base().account, server: 'https://cats.example', host: 'cats.example', community: true } }), texts: [/cats.example is a community server run by someone else/], keys: ['act-server:https://cats.example'] },
  { name: 'community server named offline', state: moment(CATS, { account: { ...base().account, world: 'offline' } }), texts: [/cats.example is a community server run by someone else/], keys: ['act-server:https://cats.example', 'dismiss-server:https://cats.example'] },
  { name: 'community server selected but offline', state: moment(CATS, { account: { ...base().account, world: 'offline', server: CATS.origin } }), texts: [/cats.example is a community server run by someone else/], keys: ['act-server:https://cats.example', 'dismiss-server:https://cats.example'] },
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
function draws(on: On, rowOverride?: { value: number | undefined }): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => band({
    el: $.ui.resolve(e) as unknown as El, surface: e.surface, columns: e.props.bodyColumns,
    rows: rowOverride ? rowOverride.value as number : e.props.maxRows,
    now: current.now, actions, isWorking: e.props.isWorking, state: current.state,
  }) ?? { type: 'Text', props: {}, children: ['engine band'] })
}

const LONG = { timeoutMs: 120_000 }
const MOUNT = { plugin: 'spinlings', component: 'AbovePrompt', requestId: 'band' } as const

const props = (columns: number, maxRows = 12) => ({ hasSurvey: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} })

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
      // in a row that does not wrap, a growing child (the text beside the art) gets only what its siblings leave
      const grows = (k: unknown) => row && p.flexWrap !== 'wrap' && isNode(k) && Number(k.props?.flexGrow ?? 0) > 0
      const fixed = kids.map(k => (grows(k) ? null : measure(k, inner, problems)))
      const shown = kids.filter((k, i) => grows(k) || (fixed[i]!.w > 0 || fixed[i]!.h > 0)).length
      const growing = kids.filter(grows).length
      const left = inner - fixed.reduce((s, x) => s + (x?.w ?? 0), 0) - gap * Math.max(0, shown - 1)
      const parts = kids.map((k, i) => fixed[i] ?? measure(k, Math.max(1, Math.floor(left / Math.max(1, growing))), problems))
        .filter(x => x.w > 0 || x.h > 0)
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

/** SVG text and alt labels are visible game copy, but the headless engine's text query cannot inspect them. */
function wordsOf(n: unknown): string {
  const art = walk(n).filter(x => x.type === 'Svg').map(x => {
    const source = String(x.props?.source ?? '')
    const text = [...source.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]!.replace(/<[^>]*>/g, '')).join(' ')
    return String(x.props?.alt ?? '') + ' ' + text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  })
  return [textOf(n), ...art].join(' ')
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
          expect(wordsOf(tree)).toMatch(text)
        }
        for (const key of f.keys ?? []) expect(`${where}: ${(await ui.find({ key })) ? 'has' : 'lacks'} ${key}`).toBe(`${where}: has ${key}`)
        await ui.unmount()
      }
    }
  })
}

test('the terminal keeps its fighter layouts and the desktop shows one shared battle scene', LONG, async ($, on) => {
  draws(on)
  current = { state: at({ battle: battle({ kind: 'duel', shown: 1 }) }), now: NOW }
  for (const [columns, keys] of [[120, ['band-a', 'band-d']], [80, ['band-a', 'band-d']], [40, ['band-d-art', 'band-a-line', 'band-d-line']]] as const) {
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(columns) })
    const rasters = (await ui.findAll({ type: 'Raster' })).map(r => r.key)
    expect(rasters).toEqual([...keys])
    await ui.unmount()
  }
  const desk = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(80) })
  expect((await desk.findAll({ type: 'Svg' })).length).toBe(1)
  expect((await desk.findAll({ type: 'Svg' })).every(s => s.props.isInteractive !== true)).toBe(true)
  expect((await desk.findAll({ type: 'Svg' })).some(s => /<(?:animate(?:Transform|Motion)?|set)\b/.test(String(s.props.source)))).toBe(true)
  await desk.unmount()
  current = { state: at({ battle: battle({ kind: 'duel', shown: 1 }), prefs: { quiet: false, motion: false, sound: false } }), now: NOW }
  const still = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(80) })
  expect((await still.findAll({ type: 'Svg' })).some(s => s.props.isInteractive === true)).toBe(false)
  await still.unmount()
})

test('desktop image documents carry the local battle and round identity with motion on or off', LONG, async ($, on) => {
  draws(on)
  const b = battle({ kind: 'duel', shown: 1 })
  for (const motion of [true, false]) {
    current = { state: at({ battle: b, prefs: { quiet: false, motion, sound: false } }), now: NOW }
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(80) })
    const scenes = await ui.findAll({ type: 'Svg' })
    expect(scenes.length).toBe(1)
    expect(String(scenes[0]!.props.source)).toContain('<metadata id="arena-instance">' + b.id + '/2</metadata>')
    expect(scenes[0]!.props.isInteractive === true).toBe(false)
    await ui.unmount()
  }
})

test('desktop arena sizes retain pixel bounds and reachable native actions, with compact fallbacks below 40 columns', LONG, async ($, on) => {
  draws(on)
  const ordinary = duelLog.rounds.findIndex(r => !r.actions.some(a => a.side === 'a' && a.move === 'special'))
  expect(ordinary).toBeGreaterThanOrEqual(0)
  for (const shown of [ordinary, perfectAt - 1]) for (const prefs of [
    { quiet: false, motion: true, sound: false },
    { quiet: false, motion: false, sound: false },
    { quiet: true, motion: true, sound: false },
  ]) for (const columns of [20, 32, 40, 60, 80, 120]) {
    const ready = shown === perfectAt - 1
    current = { state: at({ battle: battle({ kind: 'duel', shown }), prefs }), now: NOW }
    calls.length = 0
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(columns) })
    const tree = await ui.drawn()
    const nodes = walk(tree), buttons = nodes.filter(n => n.type === 'Button')
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(columns < 40 ? 0 : 1)
    expect(buttons.filter(n => n.props?.variant === 'primary').map(n => n.props?.label)).toEqual(ready ? ['Now!'] : [])
    if (ready) {
      expect(buttons.find(n => n.props?.label === 'Now!')!.props).toMatchObject({ label: 'Now!', hotkey: '1', variant: 'primary' })
      expect(!!(await ui.find({ key: 'now' }))).toBe(true)
    }
    if (columns < 40) {
      const problems: string[] = []
      const size = measure(tree, columns, problems)
      expect(problems).toEqual([])
      expect(size.w).toBeLessThanOrEqual(columns)
      expect(size.h).toBeLessThanOrEqual(2)
      expect(buttons.map(n => n.props?.label)).toEqual(ready ? ['Now!'] : [])
      expect(!!(await ui.find({ key: 'battle-today' }))).toBe(false)
      // The action leads the first compact row rather than adding a third crowded row.
      if (ready && isNode(tree)) expect(walk(tree.children?.[0]).find(n => n.type === 'Button')?.props?.label).toBe('Now!')
    } else {
      const expected = { width: Math.min(1280, columns * 8), height: 144 }
      for (const svg of svgs) {
        expect({ width: svg.props.width, height: svg.props.height }).toEqual(expected)
        const source = String(svg.props.source)
        expect(source).toContain(`viewBox="0 0 ${expected.width} ${expected.height}"`)
        expect(new TextEncoder().encode(source).length).toBeLessThanOrEqual(131072)
        expect(String(svg.props.alt)).toMatch(/vs Rival Thistlewick/)
        expect(String(svg.props.alt)).toContain(`round ${shown + 1}`)
        expect(svg.props.isInteractive === true).toBe(false)
        if (!prefs.motion || prefs.quiet) expect(source).not.toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
        else expect(source).toMatch(/<(?:animate(?:Transform|Motion)?|set)\b/)
      }
      // Unlike the terminal-only gate's zero-sized SVG placeholder, account for actual intrinsic pixels here.
      expect(svgs.reduce((sum, svg) => sum + Number(svg.props.width), 0)).toBeLessThanOrEqual(columns * 8)
      expect(Math.max(...svgs.map(svg => Number(svg.props.height)))).toBeLessThanOrEqual(144)
      expect(!!(await ui.find({ type: 'Text', text: /^vs Rival Thistlewick$/ }))).toBe(true)
      expect(textOf(tree)).toContain(`Round ${shown + 1}`)
      expect(textOf(tree)).toContain('Streak 2')
      const today = await ui.find({ key: 'battle-today' })
      expect(!!today).toBe(true)
      expect(today!.props.hotkey).toBe('2')
      expect(today!.props.variant === 'primary').toBe(false)
      expect(buttons.length).toBe(ready ? 2 : 1)
      if (columns === 40 || columns === 120) {
        await ui.press({ key: 'battle-today', plugin: 'test' })
        expect(calls).toEqual([['open', [{ view: { kind: 'today', rule: 'calm' } }]]])
        calls.length = 0
      }
    }
    if (ready && (columns === 20 || columns === 120)) {
      await ui.press({ key: 'now', plugin: 'test' })
      expect(calls).toEqual([['press', []]])
    } else expect(calls).toEqual([])
    await ui.unmount()
  }
})

test('desktop battles respect the advertised height and keep the primary action first when the arena cannot fit', LONG, async ($, on) => {
  draws(on)
  const ordinary = duelLog.rounds.findIndex(r => !r.actions.some(a => a.side === 'a' && a.move === 'special'))
  expect(ordinary).toBeGreaterThanOrEqual(0)
  const rounds = [
    { phase: 'fight' as const, shown: ordinary, ready: false },
    { phase: 'fight' as const, shown: perfectAt - 1, ready: true },
    { phase: 'finishing' as const, shown: duelLog.rounds.length, ready: false },
  ]
  for (const { phase, shown, ready } of rounds) for (const columns of [40, 60, 120]) for (const rows of [1, 2, 4, 8, 11, 12]) {
    current = { state: at({ battle: battle({ kind: 'duel', phase, shown }) }), now: NOW }
    calls.length = 0
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(columns, rows) })
    const tree = await ui.drawn(), problems: string[] = []
    const size = measure(tree, columns, problems), buttons = walk(tree).filter(n => n.type === 'Button')
    const svgs = await ui.findAll({ type: 'Svg' })
    const day = await ui.find({ key: 'battle-today' })
    expect(svgs.length).toBe(rows >= 12 ? 1 : 0)
    expect(!!day).toBe(rows >= 12)
    expect(buttons.filter(n => n.props?.variant === 'primary').map(n => n.props?.label)).toEqual(ready ? ['Now!'] : [])
    if (rows < 12) {
      expect(problems).toEqual([])
      expect(size.w).toBeLessThanOrEqual(columns)
      expect(size.h).toBeLessThanOrEqual(Math.min(2, rows))
      expect(size.h).toBeLessThanOrEqual(Math.min(4, rows))
      expect(buttons.map(n => n.props?.label)).toEqual(ready ? ['Now!'] : [])
      if (ready && isNode(tree)) expect(walk(tree.children?.[0]).find(n => n.type === 'Button')?.props?.label).toBe('Now!')
    } else {
      // Include actual SVG pixels: one 144px scene plus one native header and footer fits the 184px cap.
      expect(size.h).toBe(2)
      expect(problems).toEqual([])
      expect(size.w).toBeLessThanOrEqual(columns)
      const pixels = size.h * 20 + svgs.reduce((sum, svg) => sum + Number(svg.props.height), 0)
      expect(pixels).toBeLessThanOrEqual(184)
      expect(day!.props.hotkey).toBe('2')
      await ui.press({ key: 'battle-today', plugin: 'test' })
      expect(calls).toEqual([['open', [{ view: { kind: 'today', rule: 'calm' } }]]])
      calls.length = 0
    }
    if (ready) {
      const now = await ui.find({ key: 'now' })
      expect(now!.props).toMatchObject({ label: 'Now!', hotkey: '1', variant: 'primary' })
      await ui.press({ key: 'now', plugin: 'test' })
      expect(calls).toEqual([['press', []]])
    } else expect(calls).toEqual([])
    await ui.unmount()
  }
})

test('the real desktop matchup header sanitizes a rival name while native Day and Now remain reachable', LONG, async ($, on) => {
  draws(on)
  for (const columns of [40, 120]) {
    const b = battle({ kind: 'duel', shown: perfectAt - 1 })
    current = { state: at({ battle: { ...b, opponent: { kind: 'rival', name: 'A<&"B\u001b[31m\u202e', league: 'Pebble' } } }), now: NOW }
    calls.length = 0
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(columns) })
    const tree = await ui.drawn(), shown = textOf(tree)
    expect(!!(await ui.find({ type: 'Text', text: /^vs Rival A<&"B$/ }))).toBe(true)
    expect(shown).not.toContain('\u001b')
    expect(shown).not.toContain('\u202e')
    await ui.press({ key: 'battle-today', plugin: 'test' })
    expect(calls).toEqual([['open', [{ view: { kind: 'today', rule: 'calm' } }]]])
    calls.length = 0
    await ui.press({ key: 'now', plugin: 'test' })
    expect(calls).toEqual([['press', []]])
    await ui.unmount()
  }
})

test('missing or invalid app-level row budgets fall back to compact desktop battle words', LONG, async ($, on) => {
  // The SDK receives valid host props; only the view function's input exercises an older or malformed host value.
  const override: { value: number | undefined } = { value: undefined }
  draws(on, override)
  for (const rows of [undefined, Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) for (const columns of [40, 120]) {
    override.value = rows
    current = { state: at({ battle: battle({ kind: 'duel', shown: perfectAt - 1 }) }), now: NOW }
    calls.length = 0
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop', props: props(columns) })
    const tree = await ui.drawn(), problems: string[] = []
    const size = measure(tree, columns, problems)
    expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    expect(!!(await ui.find({ key: 'battle-today' }))).toBe(false)
    expect(problems).toEqual([])
    expect(size.h).toBeLessThanOrEqual(2)
    if (isNode(tree)) expect(walk(tree.children?.[0]).find(n => n.type === 'Button')?.props?.label).toBe('Now!')
    await ui.press({ key: 'now', plugin: 'test' })
    expect(calls).toEqual([['press', []]])
    await ui.unmount()
  }
})

test('effort changes only local ink and the player frame, with identical words, controls and animation timelines', LONG, async ($, on) => {
  draws(on)
  const state = at({ battle: battle({ kind: 'duel', shown: 1 }) })
  const read = async (effort: 'low' | 'max', surface: 'terminal' | 'desktop') => {
    current = { state: { ...state, signals: { ...state.signals, effort } }, now: NOW }
    const ui = await $.ui.mount({ ...MOUNT, surface, props: props(80) })
    const tree = await ui.drawn(), text = wordsOf(tree)
    const textNodes = walk(tree).filter(n => n.type === 'Text').map(n => ({ text: textOf(n), props: n.props }))
    const sources = (await ui.findAll({ type: 'Svg' })).map(n => String(n.props.source))
    const controls = (await ui.findAll({ type: 'Button' })).map(n => ({ label: n.props.label, hotkey: n.props.hotkey }))
    const header = (await ui.find({ type: 'Text', text: /vs Rival Thistlewick/ }))?.props
    await ui.unmount()
    return { text, sources, controls, header, textNodes }
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const low = await read('low', surface), max = await read('max', surface)
    expect(max.text).toBe(low.text)
    expect(max.controls).toEqual(low.controls)
    if (surface === 'desktop') {
      expect(low.sources.length).toBe(1)
      expect(max.sources.length).toBe(1)
      expect(max.textNodes).toEqual(low.textNodes)
      const outline = (source: string) => source.match(/<ellipse\b(?=[^>]*\bid="effort-a")[^>]*>/)?.[0] ?? ''
      expect(outline(low.sources[0]!)).toMatch(/stroke-opacity="0.3"/)
      expect(outline(low.sources[0]!)).toMatch(/stroke-width="1"/)
      expect(outline(max.sources[0]!)).toMatch(/stroke-opacity="1"/)
      expect(outline(max.sources[0]!)).toMatch(/stroke-width="2"/)
      const withoutEffort = (source: string) => source.replace(/<ellipse\b(?=[^>]*\bid="effort-a")[^>]*>/, tag => tag.replace(/\sstroke-opacity="[^"]*"|\sstroke-width="[^"]*"/g, ''))
      // The entire opponent and scene stay byte-identical; only the player's outline strength may differ.
      expect(withoutEffort(max.sources[0]!)).toBe(withoutEffort(low.sources[0]!))
      const timeline = (source: string) => [...source.matchAll(/<(?:animate|animateTransform|set)\b[^>]*>/g)].map(m => m[0])
      expect(timeline(max.sources[0]!)).toEqual(timeline(low.sources[0]!))
    } else {
      expect(low.header).toMatchObject({ dimColor: true, bold: false })
      expect(max.header).toMatchObject({ dimColor: false, bold: true })
    }
  }
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

test('a community server\'s notice offers Connect from either world, and Got it only when already online there', LONG, async ($, on) => {
  draws(on)
  const labels = async (name: string) => {
    current = { state: FIXTURES.find(f => f.name === name)!.state, now: NOW }
    const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal', props: props(80) })
    const shown = (await ui.findAll({ type: 'Button' })).map(b => `${String(b.props.label)} on ${String(b.props.hotkey)}`)
    await ui.unmount()
    return shown
  }
  expect(await labels('community server')).toEqual(['Connect on 1', 'Cancel on 2'])
  expect(await labels('community server named offline')).toEqual(['Connect on 1', 'Cancel on 2'])
  expect(await labels('community server selected but offline')).toEqual(['Connect on 1', 'Cancel on 2'])
  expect(await labels('community server in use (the Server URL option)')).toEqual(['Got it on 1'])
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

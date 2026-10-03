// `/spin demo` (SPEC 21): every pane state and every band moment, drawn from a made-up but rule-true world, for a
// human to review. The cards come from the same core rules the game uses (starters, pack cards, a Mythic, a fusion,
// a drop promo), so each screen shows real sprites, stamps and numbers. Pure; the demo's buttons do nothing.
import { FEATURES } from '../core/api.ts'
import type { BoardResponse, GiftView, OfferView, ProfileResponse } from '../core/api.ts'
import type { BattleLog, Card, Family, NewCard, Rarity } from '../core/types.ts'
import { RULES_VERSION, perfectRounds, simulateBattle } from '../core/battle.ts'
import { cardName, fuse, mintCard, starterTeam, toBattleCard } from '../core/cards.ts'
import { FAMILIES } from '../core/families.ts'
import { promoCard } from '../core/drops.ts'
import { generateMythic } from '../core/mythics.ts'
import { rngFromSeed } from '../core/rng.ts'
import { familySpecies, legendaryOf } from '../core/species.ts'
import { traderDeals } from '../core/trader.ts'
import { dailyRule, seasonOf, utcDay } from '../core/world.ts'
import { EVOLVE_SHOW, catchPreMs } from './battleview.ts'
import { INITIAL, shareText } from './game.ts'
import { CLIENT_VERSION } from './remote.ts'
import type { Actions, Battle, GameState, Moment, Outcome, PaneUi, Reveal, View } from './types.ts'

const MIN = 60_000
const DAY = 86_400_000
/** A mod newer than this one, for the screens that show the update chip. */
const NEWER = CLIENT_VERSION.replace(/^(\d+)\.(\d+)\..*$/, (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`)

/** One demo state; a band step draws the band above the prompt, the rest draw the pane. */
export type DemoStep = { title: string; state: GameState; band?: true }

const done = async () => undefined

/** The demo's actions: every press is a no-op, so nothing in the demo touches the real game. */
export const INERT: Actions = {
  press: done, pickCatch: done, act: done, dismiss: done, open: done, close: done, tab: done, push: done, back: done,
  pane: done, hold: done, openPack: done, flip: done, doneReveal: done, setTeam: done, setForTrade: done, craft: done,
  buyPack: done, share: done, copyUpdate: done, duel: done, profile: done, load: done, offer: done, respond: done, counter: done,
  claim: done, redeem: done, wishlist: done, trade: done, world: done, connect: done, passkey: done, rerollHandle: done,
  leaderboard: done, prefs: done,
}

function world(now: number) {
  const season = seasonOf(now)
  const rng = rngFromSeed('spinlings/demo')
  const day = utcDay(now)
  let n = 0
  const id = (c: NewCard, extra: Partial<Card> = {}): Card => ({ ...c, id: `demo-${++n}`, ...extra })
  const mint = (family: Family, index: number, rarity: Rarity, extra: Partial<Card> = {}, level = 1): Card => {
    const species = rarity === 'legendary' ? legendaryOf(season, family) : familySpecies(season, family)[index]!
    return id(mintCard({ species, rarity, shiny: false, dna: Math.floor(rng() * 2 ** 32), origin: 'pack', now: now - n * MIN, level }), extra)
  }
  const starters = starterTeam('opus', rng, now - 3 * DAY).map(c => id(c, { tiredUntil: 0 }))
  starters[1] = { ...starters[1]!, tiredUntil: now + 12 * MIN }
  const pack = [
    mint('opus', 2, 'common'), mint('opus', 5, 'common', { firstFind: true }), mint('opus', 1, 'rare', {}, 2),
    mint('opus', 8, 'legendary', { shiny: true }), mint('opus', 6, 'epic', { shiny: true }),
  ]
  const more = [
    mint('haiku', 3, 'rare', { forTrade: true }, 5), mint('sonnet', 0, 'common', {}, 4), mint('fable', 4, 'epic', { forTrade: true }, 7),
    mint('haiku', 6, 'common', {}, 9), mint('sonnet', 7, 'rare', { lockedUntil: now + 20 * 60 * MIN }, 3),
  ]
  const m = generateMythic({ seed: 'demo-mythic-wren', dna: 4242, now: now - DAY, level: 6 })
  const mythic = id(m, { form: { ...m.form!, discoveredBy: 'brave-wren-41' } })
  const hybrid = id(fuse(more[0]!, more[2]!, rng, now - 2 * DAY))
  const promo = id(promoCard({ seed: 'founders-2026', name: 'Lanternmoth', family: 'fable', rarity: 'epic', foil: true, stamp: 'Founder · Oct 2026' }, 777, now))
  const cards = [...starters, ...pack, ...more, mythic, hybrid, promo]
  const theirs = [mint('fable', 2, 'rare', {}, 4), mint('haiku', 1, 'epic', {}, 6), mint('sonnet', 3, 'common', {}, 2)].map(toBattleCard)
  const offerIn: OfferView = { id: 'offer-in-1', from: 'soft-otter-42', to: 'brave-wren-41', give: [theirs[0]!, theirs[1]!], get: [toBattleCard(more[0]!)], state: 'open', createdAt: now - 2 * 60 * MIN, expiresAt: now + 2 * DAY }
  const offerIn2: OfferView = { id: 'offer-in-2', from: 'quiet-fern-07', to: 'brave-wren-41', give: [theirs[2]!], get: [toBattleCard(more[2]!)], state: 'open', createdAt: now - DAY, expiresAt: now + DAY }
  const offerOut: OfferView = { id: 'offer-out-1', from: 'brave-wren-41', to: 'misty-lark-18', give: [toBattleCard(more[1]!)], get: [], state: 'open', createdAt: now - 5 * 60 * MIN, expiresAt: now + 2 * DAY + 3 * 60 * MIN }
  const gift: GiftView = { code: 'quiet-otter-lamp-4821', card: more[3]!, createdAt: now - DAY, expiresAt: now + 13 * DAY }
  const claimed: GiftView = { code: 'amber-finch-reed-1093', card: mint('sonnet', 2, 'common'), createdAt: now - 3 * DAY, expiresAt: now + 11 * DAY, claimedBy: 'misty-lark-18' }
  const board: BoardResponse = {
    matches: [{ handle: 'soft-otter-42', theirs: theirs[1]!, mine: toBattleCard(more[2]!) }],
    recent: [{ handle: 'quiet-fern-07', card: theirs[2]! }, { handle: 'misty-lark-18', card: theirs[0]! }],
    trader: traderDeals(now).map((d, i) => ({ ...d, used: i === 2 })),
  }
  const profile: ProfileResponse = { handle: 'soft-otter-42', league: 'Grove', team: theirs, forTrade: [theirs[0]!, theirs[1]!], seenCount: 17 }
  // who the band meets: wild creatures of every foreshadowing, and a player's team
  const wild = {
    common: mint('haiku', 3, 'common', {}, 3), rare: mint('haiku', 4, 'rare', {}, 3), epic: mint('fable', 5, 'epic', {}, 4),
    shiny: mint('sonnet', 6, 'common', { shiny: true }, 3), roamer: mint('fable', 8, 'legendary', { foil: true }, 4), mythic,
  }
  const rival = [mint('fable', 6, 'common', {}, 3), mint('haiku', 1, 'rare', {}, 3)]
  const base: GameState = {
    ...INITIAL,
    account: { ...INITIAL.account, link: 'ready', features: [...FEATURES], devices: { sessions: 2, passkeys: 0 } },
    me: {
      player: {
        handle: 'brave-wren-41', handleRerollFrom: day, sparks: 340, rating: 1312, league: 'Grove', leaderboard: false,
        joinedDay: utcDay(now - 9 * DAY), battles: 48, canTrade: true, team: starters.map(c => c.id), wishlist: [theirs[1]!.species],
        cardsVersion: 7, streak: 2, seen: [...new Set(cards.map(c => c.species).filter(s => /^s\d/.test(s)))], rested: false,
        nextWildAt: 0, nextDuelAt: 0, nextChargeAt: 0,
      },
      packs: [{ id: 'demo-pack-1', family: 'opus', source: 'charge', day }, { id: 'demo-pack-2', family: 'haiku', source: 'daily', day }],
      notices: [
        { id: 'n1', day, kind: 'defense-loss', text: 'soft-otter-42 beat your team', handle: 'soft-otter-42' },
        { id: 'n2', day, kind: 'defense-win', text: 'Your team held off quiet-fern-07 · +4 sparks', handle: 'quiet-fern-07' },
        { id: 'n3', day: utcDay(now - DAY), kind: 'evolved', text: `${cardName({ ...starters[0]!, stage: 1 })} evolved into ${cardName({ ...starters[0]!, stage: 2 })}` },
        { id: 'n4', day: utcDay(now - DAY), kind: 'gift-claimed', text: 'misty-lark-18 claimed your gift', handle: 'misty-lark-18' },
      ],
      offers: { incoming: [offerIn, offerIn2], outgoing: [offerOut] },
      gifts: [gift, claimed],
      now,
    },
    cards,
    presence: { minutes: 32, need: 50, blocked: null },
    social: { board, profile, trader: { day, deals: board.trader }, leaderboard: [{ handle: 'misty-lark-18', league: 'Star', rating: 1744 }, { handle: 'brave-wren-41', league: 'Grove', rating: 1312 }], gift: { code: gift.code, link: `https://spinlings.dev/g/${gift.code}`, cardId: gift.card.id, copied: true }, loading: [] },
    privacy: [
      { at: now - 30 * MIN, method: 'POST', path: '/v1/packs/charge', body: '{"family":"opus"}' },
      { at: now - 20 * MIN, method: 'POST', path: '/v1/battles', body: '{"kind":"wild","family":"opus"}' },
      { at: now - 19 * MIN, method: 'POST', path: '/v1/battles/b-1/finish', body: '{"inputs":[3,6]}' },
      { at: now - 2 * MIN, method: 'GET', path: '/v1/me', body: '' },
    ],
    clock: now,
  }
  return { base, cards, starters, pack, more, mythic, hybrid, promo, profile, day, wild, rival }
}

type World = ReturnType<typeof world>

const pane = (s: GameState, p: Partial<PaneUi>): GameState => ({ ...s, pane: { ...s.pane, ...p } })
const view = (s: GameState, v: View, p: Partial<PaneUi> = {}): GameState => pane(s, { ...p, stack: [v] })

function reveal(w: World, kind: Reveal['kind'], cards: Card[], fresh: string[] = [], packs: Reveal['packs'] = []): Reveal {
  return { id: `demo-reveal-${kind}`, kind, family: kind === 'pack' ? 'opus' : null, cards, packs, fresh, album: { before: 12, after: 12 + fresh.length, total: 36 } }
}

function steps(now: number): DemoStep[] {
  const w = world(now)
  const s = w.base
  const fresh = [w.pack[1]!.species, w.pack[3]!.species]
  const packR = reveal(w, 'pack', w.pack, fresh)
  const at = (r: Reveal, flipped: number): GameState => ({ ...view(s, { kind: 'reveal' }, { flipped }), reveal: r })
  const offline: GameState = {
    ...s, account: { ...s.account, world: 'offline', features: ['rivals', 'trader', 'mythics', 'seasons'], devices: null },
    me: { ...s.me!, offers: { incoming: [], outgoing: [] }, gifts: [] }, privacy: [],
  }
  return [
    { title: 'Team · the daily hello', state: pane(s, { tab: 'team', hello: true }) },
    { title: 'Team · slots, resting, notices with Revenge', state: pane(s, { tab: 'team' }) },
    { title: 'Team · a brand-new player', state: { ...pane(s, { tab: 'team' }), cards: [], me: { ...s.me!, player: { ...s.me!.player, team: [], streak: 0 }, notices: [] } } },
    { title: 'Cards · the collection', state: pane(s, { tab: 'cards' }) },
    { title: 'Cards · a filter with nothing in it', state: pane(s, { tab: 'cards', family: FAMILIES.find(f => !w.cards.some(c => c.family === f && c.rarity === 'legendary')) ?? 'haiku', rarity: 'legendary' }) },
    { title: 'Cards · empty collection', state: { ...pane(s, { tab: 'cards' }), cards: [] } },
    { title: 'Card · a legendary shiny foil', state: view(s, { kind: 'card', cardId: w.pack[3]!.id }, { tab: 'cards' }) },
    { title: 'Card · a starter (stays with you)', state: view(s, { kind: 'card', cardId: w.starters[0]!.id }, { tab: 'cards' }) },
    { title: 'Card · a share to copy by hand (no clipboard here)', state: view(s, { kind: 'card', cardId: w.pack[3]!.id }, { tab: 'cards', toCopy: shareText(w.pack[3]!, 'online', 'https://spinlings.dev') }) },
    { title: 'Card · recycle armed (2-second hold)', state: view(s, { kind: 'card', cardId: w.more[1]!.id }, { tab: 'cards', hold: { action: 'recycle', target: w.more[1]!.id, startedAt: now } }) },
    { title: 'Card · a Mythic', state: view(s, { kind: 'card', cardId: w.mythic.id }, { tab: 'cards' }) },
    { title: 'Card · trade-locked for a day', state: view(s, { kind: 'card', cardId: w.more[4]!.id }, { tab: 'cards' }) },
    { title: 'Fuse · pick a partner', state: view(s, { kind: 'fuse', cardId: w.more[1]!.id, otherId: null }, { tab: 'cards' }) },
    { title: 'Fuse · ready, hold armed', state: view(s, { kind: 'fuse', cardId: w.more[1]!.id, otherId: w.more[3]!.id }, { tab: 'cards', hold: { action: 'fuse', target: `${w.more[1]!.id}|${w.more[3]!.id}`, startedAt: now } }) },
    { title: 'Album · Opus', state: pane(s, { tab: 'album', album: 'opus' }) },
    { title: 'Album · Fable, mostly unseen', state: pane(s, { tab: 'album', album: 'fable' }) },
    { title: 'Album · the Fusion Log', state: pane(s, { tab: 'album', album: 'fusion' }) },
    { title: 'Album · a species, craft and wishlist', state: view(s, { kind: 'species', speciesId: w.pack[2]!.species }, { tab: 'album' }) },
    { title: 'Album · an unseen legendary', state: view(s, { kind: 'species', speciesId: legendaryOf(seasonOf(now), 'haiku').id }, { tab: 'album' }) },
    { title: 'Trade · inbox', state: pane(s, { tab: 'trade', page: 0 }) },
    { title: 'Trade · empty inbox', state: { ...pane(s, { tab: 'trade', page: 0 }), me: { ...s.me!, offers: { incoming: [], outgoing: [] } } } },
    { title: 'Trade · a new player\'s inbox', state: { ...pane(s, { tab: 'trade', page: 0 }), me: { ...s.me!, player: { ...s.me!.player, canTrade: false }, offers: { incoming: [], outgoing: [] }, gifts: [] } } },
    { title: 'Trade · the board', state: pane(s, { tab: 'trade', page: 1 }) },
    { title: 'Trade · the Wandering Trader', state: pane(s, { tab: 'trade', page: 2 }) },
    { title: 'Trade · the Trader has not come by', state: { ...pane(s, { tab: 'trade', page: 2 }), social: { ...s.social, trader: null } } },
    { title: 'Trade · gifts, claim and redeem', state: pane(s, { tab: 'trade', page: 3 }) },
    { title: 'Trade · a profile and an offer being built', state: view(s, { kind: 'profile', handle: 'soft-otter-42', give: [w.more[0]!.id], get: [w.profile.forTrade[1]!.id], counterOf: null }, { tab: 'trade' }) },
    { title: 'Trade · a gift just wrapped', state: view(s, { kind: 'gift', code: 'quiet-otter-lamp-4821' }, { tab: 'cards' }) },
    { title: 'Trade · a gift just wrapped, to copy by hand', state: { ...view(s, { kind: 'gift', code: 'quiet-otter-lamp-4821' }, { tab: 'cards' }), social: { ...s.social, gift: { ...s.social.gift!, copied: false } } } },
    { title: 'Pack · sealed, waiting to tear', state: at(packR, 0) },
    { title: 'Pack · two turned, a gold back waiting', state: at(packR, 2) },
    { title: 'Pack · LEGENDARY!', state: at(packR, 4) },
    { title: 'Pack · the summary', state: at(packR, 5) },
    { title: 'Fusion · the egg', state: at(reveal(w, 'egg', [w.hybrid]), 0) },
    { title: 'Fusion · hatched', state: at(reveal(w, 'egg', [w.hybrid]), 1) },
    { title: 'Present · wrapped', state: at(reveal(w, 'present', [w.more[3]!]), 0) },
    { title: 'Drop · the Founder\'s egg hatched', state: at(reveal(w, 'egg', [w.promo], [w.promo.species]), 1) },
    { title: 'Trader · a pack in return', state: at(reveal(w, 'trader', [], [], [{ id: 'demo-pack-3', family: 'sonnet', source: 'trader', day: w.day }]), 0) },
    { title: 'Privacy · online', state: view(s, { kind: 'privacy' }) },
    { title: 'Privacy · reset access armed', state: view(s, { kind: 'privacy' }, { hold: { action: 'reset-access', target: 'me', startedAt: now } }) },
    { title: 'Devices · a passkey page open', state: { ...view(s, { kind: 'devices' }), account: { ...s.account, signIn: { kind: 'add', url: 'https://spinlings.dev/passkey/add?t=demo', until: now + 9 * MIN, status: 'pending' } } } },
    { title: 'Offline · the Trade tab', state: pane(offline, { tab: 'trade' }) },
    { title: 'Offline · privacy', state: view(offline, { kind: 'privacy' }) },
    { title: 'Feedback · busy and a message', state: pane(s, { tab: 'cards', busy: 'Opening the pack', message: 'Not enough sparks for that yet.' }) },
    { title: 'Link · cannot reach the server', state: { ...pane(s, { tab: 'team' }), account: { ...s.account, link: 'unreachable', note: 'Can\'t reach spinlings.dev right now' } } },
    { title: 'Link · read-only below minClient', state: { ...pane(s, { tab: 'team' }), account: { ...s.account, readOnly: true, latest: NEWER } } },
    { title: 'Version · a newer mod is out: the footer chip', state: { ...pane(s, { tab: 'cards' }), account: { ...s.account, latest: NEWER } } },
    { title: 'Version · the update command, ready to copy', state: { ...pane(s, { tab: 'trade', page: 0, showUpdate: true }), account: { ...s.account, latest: NEWER } } },
    { title: 'Version · the update command copied', state: { ...pane(s, { tab: 'trade', page: 0, showUpdate: true, message: 'Copied. Run it in a terminal.', tone: 'good' }), account: { ...s.account, latest: NEWER } } },
    { title: 'First run · hatching', state: { ...INITIAL, account: { ...INITIAL.account, link: 'joining' }, clock: now } },
    { title: 'Start · this computer is signed out', state: { ...pane(s, { tab: 'team' }), account: { ...s.account, link: 'signed-out', note: 'This computer is signed out of spinlings.dev · /spin world online starts fresh', devices: null } } },
    { title: 'Start · the offline save cannot be opened', state: { ...INITIAL, account: { ...INITIAL.account, world: 'offline', features: offline.account.features, link: 'unreachable', note: 'This save is from a newer Spinlings. Update the mod to open it.' }, clock: now } },
    { title: 'Devices · signed out, a passkey brings the old collection', state: { ...view(s, { kind: 'devices' }), me: null, cards: [], account: { ...s.account, link: 'signed-out', note: 'This computer is signed out of spinlings.dev · /spin world online starts fresh', devices: null } } },
    ...bandSteps(w, now),
  ]
}

// ---------- the band: every moment above the prompt, in the order a first session meets them ----------

function bandSteps(w: World, now: number): DemoStep[] {
  const s = w.base
  const team = w.starters.map(toBattleCard)
  let serial = 0
  const fight = (o: { kind?: 'wild' | 'duel'; defender?: Card[]; phase?: Battle['phase']; shown?: number; inputs?: number[]; live?: boolean; first?: boolean; player?: boolean } = {}): Battle => {
    const kind = o.kind ?? 'wild'
    const defender = (o.defender ?? (kind === 'duel' ? w.rival : [w.wild.common])).map(toBattleCard)
    return {
      id: `demo-battle-${++serial}`, setup: { seed: 'spinlings/demo/battle', kind, arena: 'opus', rule: dailyRule(now), rules: RULES_VERSION, attacker: team, defender },
      opponent: kind === 'wild' ? { kind: 'wild' } : o.player ? { kind: 'player', handle: 'soft-otter-42', league: 'Grove' } : { kind: 'rival', name: 'Thistlewick', league: 'Grove' },
      subs: [], firstPossible: defender.map(() => !!o.first), startedAt: now, finishAfter: now + 30_000,
      live: o.live ?? true, phase: o.phase ?? 'fight', shown: o.shown ?? 0, inputs: o.inputs ?? [], log: null,
    }
  }
  const duel = fight({ kind: 'duel' })
  const rounds = simulateBattle(duel.setup, []) as BattleLog
  const perfectAt = perfectRounds(rounds)[0] ?? 2
  const result = (o: Partial<Outcome>): Outcome => ({
    battleId: 'demo-battle', kind: 'wild', opponent: { kind: 'wild' }, lead: toBattleCard(w.wild.common), result: 'win', sparks: 10,
    rating: 1312, ratingDelta: 0, league: null, perfect: 0, xp: [], catch: { status: 'none' }, bounty: null, dailyWinPack: false,
    streak: 3, streakPack: false, ...o,
  })
  const caught = { ...w.wild.rare, id: 'demo-caught', origin: 'catch' as const }
  const lead = w.starters[0]!
  const evolve = (clock: number): GameState => ({
    ...s, clock, moments: [{ kind: 'evolve', id: 'evolve:demo', cardId: lead.id, from: cardName({ ...lead, stage: 1 }), to: cardName({ ...lead, stage: 2 }), stage: 2, until: now + EVOLVE_SHOW }],
    cards: s.cards.map(c => (c.id === lead.id ? { ...c, stage: 2, level: 4 } : c)),
  })
  const at = (extra: Partial<GameState>): GameState => ({ ...s, ...extra })
  const moment = (m: Moment, extra: Partial<GameState> = {}): GameState => at({ moments: [m], ...extra })
  const outcome = (o: Partial<Outcome>, until: number | null = now + 12_000, clock = now): GameState => moment({ kind: 'outcome', id: 'outcome:demo', outcome: result(o), until }, { clock })
  const step = (title: string, state: GameState): DemoStep => ({ title: `Band · ${title}`, state, band: true })
  return [
    step('something is hatching (the silent join)', { ...INITIAL, account: { ...INITIAL.account, link: 'joining' }, signals: { ...INITIAL.signals, family: 'opus' }, clock: now }),
    step('A Spinling hatched! (the welcome)', moment({ kind: 'welcome', id: 'welcome', packId: 'demo-pack-1', until: null })),
    step('the one-time hint after the welcome pack', moment({ kind: 'line', id: 'line:hint:first-run', tone: 'hint', text: 'Creatures find you while Claude works · /spin to open your collection', until: now + 10_000 })),
    step('no network on the first run: the welcome says so', moment({ kind: 'welcome', id: 'welcome', packId: 'demo-pack-1', until: null, note: 'Playing offline · /spin world online when you\'re connected' }, { account: { ...s.account, world: 'offline', features: ['rivals', 'trader', 'mythics', 'seasons'] } })),
    step('a notice line', moment({ kind: 'line', id: 'line:notice:fizzled', tone: 'notice', text: 'The battle fizzled out. Your team is fine.', until: now + 10_000 })),
    step('a rustle', at({ battle: fight({ phase: 'rustle' }) })),
    step('a rustle with a rare twinkle', at({ battle: fight({ phase: 'rustle', defender: [w.wild.rare] }) })),
    step('a rustle with an epic shimmer', at({ battle: fight({ phase: 'rustle', defender: [w.wild.epic] }) })),
    step('a rustle with a shiny glint', at({ battle: fight({ phase: 'rustle', defender: [w.wild.shiny] }) })),
    step('the weekly roamer: the air feels different', at({ battle: fight({ phase: 'rustle', defender: [w.wild.roamer] }) })),
    step('a Mythic stirs', at({ battle: fight({ phase: 'rustle', defender: [w.wild.mythic] }) })),
    step('a player\'s team comes to duel', at({ battle: fight({ kind: 'duel', phase: 'rustle', player: true }) })),
    step('a wild reveal: NEW, FIRST IN THE WORLD?', at({ battle: fight({ phase: 'reveal', first: true, defender: [w.wild.epic, w.wild.common] }) })),
    step('a Mythic appeared', at({ battle: fight({ phase: 'reveal', defender: [w.wild.mythic] }) })),
    step('a Rival sends out its lead', at({ battle: fight({ kind: 'duel', phase: 'reveal' }) })),
    step('the special is ready: 1 Now! (helpers cheering)', at({ battle: fight({ kind: 'duel', shown: perfectAt - 1 }), signals: { ...s.signals, family: 'opus', cheering: 2 } })),
    step('Perfect!', at({ battle: fight({ kind: 'duel', shown: perfectAt - 1, inputs: [perfectAt] }) })),
    step('a round, the streak on the line', at({ battle: fight({ kind: 'duel', player: true, shown: 0 }) })),
    step('rules differ: the server\'s log is on its way', at({ battle: fight({ kind: 'duel', live: false }) })),
    step('counting up', at({ battle: fight({ kind: 'duel', phase: 'finishing', shown: rounds.rounds.length }) })),
    step('pick one to keep', outcome({ catch: { status: 'choose', options: [w.wild.common, w.wild.rare, w.wild.epic].map(toBattleCard), deadline: now + 20_000 } }, now + 20_000)),
    step('catching…', outcome({ catch: { status: 'catching', options: [toBattleCard(w.wild.rare)], index: 0 } }, null)),
    step('Gotcha!', outcome({ catch: { status: 'caught', card: caught }, dailyWinPack: true }, now + 12_000, now + catchPreMs(caught) + 10)),
    step('it slipped away', outcome({ catch: { status: 'slipped' } }, now + 12_000, now + 9000)),
    step('a Mythic vanished into the static', outcome({ result: 'loss', sparks: 3, lead: toBattleCard(w.wild.mythic), catch: { status: 'fled' }, streak: 0 })),
    step('a duel won: streak pack, league, Perfect, bounty', outcome({
      kind: 'duel', opponent: { kind: 'player', handle: 'soft-otter-42', league: 'Grove' }, lead: toBattleCard(w.rival[0]!), sparks: 12, rating: 1326,
      ratingDelta: 14, league: { from: 'Brook', to: 'Grove' }, perfect: 2, streakPack: true, dailyWinPack: true, bounty: { ...w.wild.epic, id: 'demo-bounty' },
    })),
    step('a wild battle lost', outcome({ result: 'loss', sparks: 3, streak: 0 })),
    step('What? It is evolving!', evolve(now + 500)),
    step('evolved, with its gains', evolve(now + 4000)),
    step('a pack is ready', moment({ kind: 'pack-ready', id: 'pack-ready', count: 2, until: now + 6000 })),
    step('a present from another player', moment({ kind: 'present', id: 'present:demo', from: 'quiet-otter-42', cardIds: [], until: null })),
    step('a new version is out', moment({ kind: 'update', id: 'update:0.2.0', version: '0.2.0', until: null })),
    step('the passkey offer', moment({ kind: 'passkey', id: 'passkey', until: null })),
    step('this needs the online world', moment({ kind: 'needs-online', id: 'needs-online', until: now + 10_000 })),
    step('someone else\'s server', moment({ kind: 'server', id: 'server:https://cats.example', origin: 'https://cats.example', until: null })),
    step('a reaction to an early stop', moment({ kind: 'line', id: 'line:reaction:flinch', tone: 'reaction', text: `${cardName(lead)} flinched`, until: now + 4000 })),
    step('Claude is resting: only the status line speaks', at({ signals: { ...s.signals, restingUntil: now + 95 * MIN } })),
  ]
}

let cache: { minute: number; list: DemoStep[] } | null = null

/** Every demo state for this minute (the cards are minted relative to now). */
export function demoSteps(now: number): DemoStep[] {
  const minute = Math.floor(now / MIN)
  if (!cache || cache.minute !== minute) cache = { minute, list: steps(now) }
  return cache.list
}

export function demoStep(step: number, now: number): DemoStep & { index: number; count: number } {
  const list = demoSteps(now)
  const index = ((step % list.length) + list.length) % list.length
  return { ...list[index]!, index, count: list.length }
}

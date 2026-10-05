// `/spin demo` (SPEC 21): every pane state and every band moment, drawn from a made-up but rule-true world, for a
// human to review. The cards come from the same core rules the game uses (starters, pack cards, a Mythic, a fusion,
// a drop promo), so each screen shows real sprites, stamps and numbers. Pure; the demo's buttons do nothing.
import { FEATURES } from '../core/api.ts'
import type {
  BoardResponse, GiftView, ListingView, MarketWant, OfferView, PlayerStats, ProfileResponse, RankingsResponse,
} from '../core/api.ts'
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
import { INITIAL, MARKET_DEFAULT, shareText } from './game.ts'
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
  community: done,
  press: done, pickCatch: done, act: done, dismiss: done, open: done, close: done, tab: done, push: done, back: done,
  pane: done, hold: done, openPack: done, flip: done, doneReveal: done, setTeam: done, setForTrade: done, craft: done,
  buyPack: done, share: done, shareProfile: done, copyUpdate: done, duel: done, challenge: done, market: done, list: done, buy: done, prices: done,
  rankings: done, marketFilter: done, profile: done, load: done, offer: done, respond: done, counter: done,
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
  const examples = [
    mint('opus', 2, 'common'), mint('opus', 5, 'common', { firstFind: true }), mint('opus', 1, 'rare', {}, 2),
    mint('opus', 8, 'legendary', { shiny: true }), mint('opus', 6, 'epic', { shiny: true }),
  ]
  const pack = [examples[0]!]
  const more = [
    mint('haiku', 3, 'rare', { forTrade: true }, 5), mint('sonnet', 0, 'common', {}, 4), mint('fable', 4, 'epic', { forTrade: true }, 7),
    mint('haiku', 6, 'common', {}, 9), mint('sonnet', 7, 'rare', {}, 3),
  ]
  const m = generateMythic({ seed: 'demo-mythic-wren', dna: 4242, now: now - DAY, level: 6 })
  const mythic = id(m, { form: { ...m.form!, discoveredBy: 'brave-wren-41' } })
  const hybrid = id(fuse(more[0]!, more[2]!, rng, now - 2 * DAY))
  const promo = id(promoCard({ seed: 'founders-2026', name: 'Lanternmoth', family: 'fable', rarity: 'epic', foil: true, stamp: 'Founder · Oct 2026' }, 777, now))
  const cards = [...starters, ...examples, ...more, mythic, hybrid, promo]
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
  const stats: PlayerStats = {
    duelWins: 23, duelLosses: 11, playersBeaten: 9, wildWins: 31, catches: 27, speciesCollected: 19, firstFinds: 2, mythicsFound: 1, marketSales: 4,
  }
  const profile: ProfileResponse = {
    handle: 'soft-otter-42', league: 'Grove', team: theirs, forTrade: [theirs[0]!, theirs[1]!], seenCount: 17,
    stats: { duelWins: 41, duelLosses: 20, playersBeaten: 17, wildWins: 52, catches: 44, speciesCollected: 17, firstFinds: 0, mythicsFound: 0, marketSales: 12 },
  }
  // the market: listings for sparks, for a card and for both, from several sellers, and two of yours
  const fusionSeller = id(fuse(mint('haiku', 2, 'rare'), mint('fable', 6, 'epic'), rng, now - 4 * DAY), { origin: 'fusion' })
  const forSale = [
    mint('sonnet', 4, 'epic', { shiny: true }, 6), mint('haiku', 5, 'rare', {}, 3), mint('opus', 7, 'legendary', { foil: true }, 8),
    mint('fable', 1, 'common', {}, 2), fusionSeller, mint('sonnet', 2, 'rare', { foil: true }, 4),
  ]
  const sellers = ['soft-otter-42', 'quiet-fern-07', 'misty-lark-18', 'amber-finch-reed', 'brisk-heron-90', 'soft-otter-42']
  const wants: (MarketWant | undefined)[] = [undefined, { species: more[0]!.species }, undefined, { family: 'opus', rarity: 'rare' }, { species: theirs[2]!.species, shiny: true }, undefined]
  const prices = [180, 0, 2400, 15, 120, 260]
  const listings: ListingView[] = forSale.map((c, i) => ({
    id: `listing-${i + 1}`, seller: sellers[i]!, card: toBattleCard(c), price: prices[i]!, ...(wants[i] ? { want: wants[i] } : {}),
    day: utcDay(now - i * DAY), state: 'open',
  }))
  const mineListed: ListingView[] = [
    { id: 'listing-mine-1', seller: 'brave-wren-41', card: toBattleCard(more[2]!), price: 320, day, state: 'open' },
    { id: 'listing-mine-2', seller: 'brave-wren-41', card: toBattleCard(more[0]!), price: 0, want: { family: 'sonnet', rarity: 'epic' }, day: utcDay(now - 2 * DAY), state: 'open' },
  ]
  const sales = (rarity: Rarity, ...ps: number[]) => ps.map((price, i) => ({ day: utcDay(now - (i + 1) * DAY), price, rarity, shiny: false, foil: false }))
  const marketPrices = [
    { species: forSale[0]!.species, sales: sales('epic', 210, 165, 190) },
    { species: forSale[2]!.species, sales: sales('legendary', 2600, 2250) },
    { species: more[1]!.species, sales: sales('common', 30, 25, 40, 35) },
  ]
  const rankings: RankingsResponse = {
    board: 'rating', period: 'all', season: seasonOf(now),
    top: [
      { rank: 1, handle: 'misty-lark-18', league: 'Star', value: 1744 }, { rank: 2, handle: 'quiet-fern-07', league: 'Peak', value: 1610 },
      { rank: 3, handle: 'soft-otter-42', league: 'Peak', value: 1588 }, { rank: 4, handle: 'amber-finch-reed', league: 'Grove', value: 1490 },
      { rank: 5, handle: 'brisk-heron-90', league: 'Grove', value: 1460 }, { rank: 5, handle: 'lantern-moth-11', league: 'Grove', value: 1460 },
      { rank: 7, handle: 'pale-wren-03', league: 'Peak', value: 1402 },
    ],
    me: { rank: 12, handle: 'brave-wren-41', league: 'Grove', value: 1312 },
  }
  // who the band meets: wild creatures of every foreshadowing, and a player's team
  const wild = {
    common: mint('haiku', 3, 'common', {}, 3), rare: mint('haiku', 4, 'rare', {}, 3), epic: mint('fable', 5, 'epic', {}, 4),
    shiny: mint('sonnet', 6, 'common', { shiny: true }, 3), roamer: mint('fable', 8, 'legendary', { foil: true }, 4), mythic,
  }
  const rival = [mint('fable', 6, 'common', {}, 3), mint('haiku', 1, 'rare', {}, 3)]
  const base: GameState = {
    ...INITIAL,
    account: { ...INITIAL.account, link: 'ready', features: [...FEATURES], devices: { sessions: 2, passkeys: 1 }, backedUp: true },
    me: {
      player: {
        handle: 'brave-wren-41', handleRerollFrom: day, sparks: 340, rating: 1312, league: 'Grove', leaderboard: true,
        joinedDay: utcDay(now - 9 * DAY), battles: 48, canTrade: true, team: starters.map(c => c.id), wishlist: [theirs[1]!.species],
        cardsVersion: 7, streak: 2, seen: [...new Set(cards.map(c => c.species).filter(s => /^s\d/.test(s)))], rested: false,
        nextWildAt: 0, nextDuelAt: 0, nextChargeAt: 0, stats,
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
      listings: mineListed,
      now,
    },
    cards: cards.map(c => (mineListed.some(l => l.card.id === c.id) ? { ...c, state: 'escrow' as const } : c)),
    presence: { minutes: 32, need: 50, blocked: null },
    social: {
      board, profile, trader: { day, deals: board.trader }, leaderboard: [{ handle: 'misty-lark-18', league: 'Star', rating: 1744 }, { handle: 'brave-wren-41', league: 'Grove', rating: 1312 }],
      rankings, market: { listings, next: 'demo-page-2', prices: marketPrices, query: MARKET_DEFAULT }, prices: marketPrices,
      gift: { code: gift.code, link: `https://spinlings.dev/g/${gift.code}`, cardId: gift.card.id, copied: true }, loading: [],
    },
    privacy: [
      { at: now - 30 * MIN, method: 'POST', path: '/v1/packs/charge', body: '{"family":"opus"}' },
      { at: now - 20 * MIN, method: 'POST', path: '/v1/battles', body: '{"kind":"wild","family":"opus"}' },
      { at: now - 19 * MIN, method: 'POST', path: '/v1/battles/b-1/finish', body: '{"inputs":[3,6]}' },
      { at: now - 2 * MIN, method: 'GET', path: '/v1/me', body: '' },
    ],
    clock: now,
  }
  return { base, cards, starters, pack, examples, more, mythic, hybrid, promo, profile, day, wild, rival, listings, forSale, rankings }
}

type World = ReturnType<typeof world>

const pane = (s: GameState, p: Partial<PaneUi>): GameState => ({ ...s, pane: { ...s.pane, ...p, ...(p.tab === 'market' ? { tab: 'trade', community: 'market' } : {}) } })
const view = (s: GameState, v: View, p: Partial<PaneUi> = {}): GameState => {
  if (v.kind === 'mine' || v.kind === 'trades' || v.kind === 'boards') return pane(s, { ...p, tab: 'trade', community: v.kind === 'mine' ? 'profile' : v.kind, stack: [], ...(v.kind === 'boards' ? { boards: { board: v.board, period: v.period } } : {}) })
  return pane(s, { ...p, stack: [v] })
}

function reveal(w: World, kind: Reveal['kind'], cards: Card[], fresh: string[] = [], packs: Reveal['packs'] = []): Reveal {
  return { id: `demo-reveal-${kind}`, kind, family: kind === 'pack' ? 'opus' : null, cards, packs, fresh, album: { before: 12, after: 12 + fresh.length, total: 36 } }
}

function steps(now: number): DemoStep[] {
  const w = world(now)
  const s = w.base
  const fresh = w.pack.map(c => c.species)
  const packR = reveal(w, 'pack', w.pack, fresh)
  const legendaryR = reveal(w, 'pack', [w.examples[3]!], [w.examples[3]!.species])
  const at = (r: Reveal, flipped: number): GameState => ({ ...view(s, { kind: 'reveal' }, { flipped }), reveal: r })
  // the offline world has no backup, no stats and no listings
  const { backedUp: _b, ...plain } = s.account
  const { stats: _s, ...player } = s.me!.player
  const offline: GameState = {
    ...s, account: { ...plain, world: 'offline', features: ['rivals', 'trader', 'mythics', 'seasons'], devices: null },
    me: { ...s.me!, offers: { incoming: [], outgoing: [] }, gifts: [], listings: [], player },
    privacy: [],
  }
  const unsaved = { ...s.account, devices: { sessions: 2, passkeys: 0 }, backedUp: false }
  return [
    { title: 'Team · the daily hello', state: pane(s, { tab: 'team', hello: true }) },
    { title: 'Team · slots, resting, notices with Revenge', state: pane(s, { tab: 'team' }) },
    { title: 'Team · a brand-new player', state: { ...pane(s, { tab: 'team' }), cards: [], me: { ...s.me!, player: { ...s.me!.player, team: [], streak: 0 }, notices: [] } } },
    { title: 'Cards · the collection', state: pane(s, { tab: 'cards' }) },
    { title: 'Cards · a filter with nothing in it', state: pane(s, { tab: 'cards', family: FAMILIES.find(f => !w.cards.some(c => c.family === f && c.rarity === 'legendary')) ?? 'haiku', rarity: 'legendary' }) },
    { title: 'Cards · empty collection', state: { ...pane(s, { tab: 'cards' }), cards: [] } },
    { title: 'Card · a legendary shiny foil', state: view(s, { kind: 'card', cardId: w.examples[3]!.id }, { tab: 'cards' }) },
    { title: 'Team · choose a replacement slot', state: pane(s, { tab: 'cards', stack: [{ kind: 'card', cardId: w.examples[3]!.id }, { kind: 'team-slot', cardId: w.examples[3]!.id }] }) },
    { title: 'Team · swap two teammates', state: pane(s, { tab: 'team', stack: [{ kind: 'card', cardId: w.starters[1]!.id }, { kind: 'team-slot', cardId: w.starters[1]!.id }] }) },
    { title: 'Card · a starter (stays with you)', state: view(s, { kind: 'card', cardId: w.starters[0]!.id }, { tab: 'cards' }) },
    { title: 'Card · a share to copy by hand (no clipboard here)', state: view(s, { kind: 'card', cardId: w.examples[3]!.id }, { tab: 'cards', toCopy: shareText(w.examples[3]!, 'online', 'https://spinlings.dev') }) },
    { title: 'Card · recycle armed (2-second hold)', state: view(s, { kind: 'card', cardId: w.more[1]!.id }, { tab: 'cards', hold: { action: 'recycle', target: w.more[1]!.id, startedAt: now } }) },
    { title: 'Card · a Mythic', state: view(s, { kind: 'card', cardId: w.mythic.id }, { tab: 'cards' }) },
    { title: 'Card · on the market', state: view(s, { kind: 'card', cardId: w.more[2]!.id }, { tab: 'cards' }) },
    { title: 'Fuse · pick a partner', state: view(s, { kind: 'fuse', cardId: w.more[1]!.id, otherId: null }, { tab: 'cards' }) },
    { title: 'Fuse · ready, hold armed', state: view(s, { kind: 'fuse', cardId: w.more[1]!.id, otherId: w.more[3]!.id }, { tab: 'cards', hold: { action: 'fuse', target: `${w.more[1]!.id}|${w.more[3]!.id}`, startedAt: now } }) },
    { title: 'Album · Opus', state: pane(s, { tab: 'album', album: 'opus' }) },
    { title: 'Album · Fable, mostly unseen', state: pane(s, { tab: 'album', album: 'fable' }) },
    { title: 'Album · the Fusion Log', state: pane(s, { tab: 'album', album: 'fusion' }) },
    { title: 'Album · a species, craft and wishlist', state: view(s, { kind: 'species', speciesId: w.examples[2]!.species }, { tab: 'album' }) },
    { title: 'Album · an unseen legendary', state: view(s, { kind: 'species', speciesId: legendaryOf(seasonOf(now), 'haiku').id }, { tab: 'album' }) },
    { title: 'Community · the hub', state: pane(s, { tab: 'trade' }) },
    { title: 'Community · your profile', state: view(s, { kind: 'mine' }, { tab: 'trade' }) },
    { title: 'Help · the field guide', state: view(s, { kind: 'help' }) },
    { title: 'Today · the meadow rule', state: view(s, { kind: 'today' }) },
    { title: 'Trade · inbox', state: view(s, { kind: 'trades' }, { tab: 'trade', page: 0 }) },
    { title: 'Trade · empty inbox', state: { ...view(s, { kind: 'trades' }, { tab: 'trade', page: 0 }), me: { ...s.me!, offers: { incoming: [], outgoing: [] } } } },
    { title: 'Trade · the board', state: view(s, { kind: 'trades' }, { tab: 'trade', page: 1 }) },
    { title: 'Trade · the Wandering Trader', state: view(s, { kind: 'trades' }, { tab: 'trade', page: 2 }) },
    { title: 'Trade · the Trader has not come by', state: { ...view(s, { kind: 'trades' }, { tab: 'trade', page: 2 }), social: { ...s.social, trader: null } } },
    { title: 'Trade · gifts, claim and redeem', state: view(s, { kind: 'trades' }, { tab: 'trade', page: 3 }) },
    { title: 'Trade · a profile and an offer being built', state: view(s, { kind: 'profile', handle: 'soft-otter-42', give: [w.more[0]!.id], get: [w.profile.forTrade[1]!.id], counterOf: null }, { tab: 'trade' }) },
    { title: 'Trade · a gift just wrapped', state: view(s, { kind: 'gift', code: 'quiet-otter-lamp-4821' }, { tab: 'cards' }) },
    { title: 'Trade · a gift just wrapped, to copy by hand', state: { ...view(s, { kind: 'gift', code: 'quiet-otter-lamp-4821' }, { tab: 'cards' }), social: { ...s.social, gift: { ...s.social.gift!, copied: false } } } },
    { title: 'Market · everyone\'s listings', state: pane(s, { tab: 'market' }) },
    { title: 'Market · chips narrowed, cheapest first', state: pane(s, { tab: 'market', market: { ...MARKET_DEFAULT, family: 'sonnet', rarity: 'rare', sort: 'cheapest', foil: true } }) },
    { title: 'Market · reading', state: { ...pane(s, { tab: 'market' }), social: { ...s.social, market: null, loading: ['market'] } } },
    { title: 'Market · nothing listed like that', state: { ...pane(s, { tab: 'market', market: { ...MARKET_DEFAULT, kind: 'both' } }), social: { ...s.social, market: { ...s.social.market!, listings: [], next: null } } } },
    { title: 'Market · your listings', state: pane(s, { tab: 'market', market: { ...MARKET_DEFAULT, mine: true } }) },
    { title: 'Market · a listing for sparks: give and get, then Buy', state: view(s, { kind: 'listing', listingId: w.listings[0]!.id, cardId: null }, { tab: 'market' }) },
    { title: 'Market · a swap: pick the card you give', state: view(s, { kind: 'listing', listingId: w.listings[3]!.id, cardId: w.examples[2]!.id }, { tab: 'market' }) },
    { title: 'Market · too dear for now', state: view(s, { kind: 'listing', listingId: w.listings[2]!.id, cardId: null }, { tab: 'market' }) },
    { title: 'Market · your own listing, take it off armed', state: view(s, { kind: 'listing', listingId: 'listing-mine-1', cardId: null }, { tab: 'market', hold: { action: 'cancel-listing', target: 'listing-mine-1', startedAt: now } }) },
    { title: 'Sell · the price, from recent sales', state: view(s, { kind: 'sell', cardId: w.more[1]!.id, price: 0, want: null }, { tab: 'cards' }) },
    { title: 'Sell · sparks and a card from the wishlist', state: view(s, { kind: 'sell', cardId: w.examples[4]!.id, price: 150, want: { species: s.me!.player.wishlist[0]! } }, { tab: 'cards' }) },
    { title: 'Sell · a card only', state: view(s, { kind: 'sell', cardId: w.examples[2]!.id, price: 0, want: { family: w.examples[2]!.family, rarity: w.examples[2]!.rarity } }, { tab: 'cards' }) },
    { title: 'Boards · rating, all time, your rank pinned', state: view(s, { kind: 'boards', board: 'rating', period: 'all' }, { tab: 'team' }) },
    { title: 'Boards · sales this season', state: { ...view(s, { kind: 'boards', board: 'sales', period: 'season' }, { tab: 'team' }), social: { ...s.social, rankings: { ...w.rankings, board: 'sales', period: 'season', top: w.rankings.top.slice(0, 4).map((r, i) => ({ ...r, value: [14, 9, 9, 3][i]! })), me: { ...w.rankings.me!, rank: 6, value: 2 } } } } },
    { title: 'Boards · hidden, and nobody yet', state: { ...view(s, { kind: 'boards', board: 'mythics', period: 'season' }, { tab: 'team' }), me: { ...s.me!, player: { ...s.me!.player, leaderboard: false } }, social: { ...s.social, rankings: { board: 'mythics', period: 'season', season: w.rankings.season, top: [] } } } },
    { title: 'Header · not backed up yet', state: { ...pane(s, { tab: 'team' }), account: { ...s.account, backedUp: false, devices: { sessions: 1, passkeys: 0 } } } },
    { title: 'Pack · sealed, waiting to tear', state: at(packR, 0) },
    { title: 'Pack · a gold back waiting', state: at(legendaryR, 0) },
    { title: 'Pack · a legendary foil revealed', state: at(legendaryR, 1) },
    { title: 'Pack · the summary', state: at(packR, 1) },
    { title: 'Fusion · the egg', state: at(reveal(w, 'egg', [w.hybrid]), 0) },
    { title: 'Fusion · hatched', state: at(reveal(w, 'egg', [w.hybrid]), 1) },
    { title: 'Present · wrapped', state: at(reveal(w, 'present', [w.more[3]!]), 0) },
    { title: 'Drop · the Founder\'s egg hatched', state: at(reveal(w, 'egg', [w.promo], [w.promo.species]), 1) },
    { title: 'Trader · a pack in return', state: at(reveal(w, 'trader', [], [], [{ id: 'demo-pack-3', family: 'sonnet', source: 'trader', day: w.day }]), 0) },
    { title: 'Privacy · online', state: { ...view(s, { kind: 'privacy' }), account: unsaved } },
    { title: 'Privacy · reset access armed', state: view(s, { kind: 'privacy' }, { hold: { action: 'reset-access', target: 'me', startedAt: now } }) },
    { title: 'Devices · not backed up: the offer', state: { ...view(s, { kind: 'devices' }), account: unsaved } },
    { title: 'Devices · a passkey page open', state: { ...view(s, { kind: 'devices' }), account: { ...unsaved, signIn: { kind: 'add', url: 'https://spinlings.dev/passkey/add?t=demo', until: now + 9 * MIN, status: 'pending' } } } },
    { title: 'Devices · passkey saved', state: { ...view(s, { kind: 'devices' }), account: { ...s.account, signIn: { kind: 'add', url: 'https://spinlings.dev/passkey/add?t=demo', until: now + 9 * MIN, status: 'added' } } } },
    { title: 'Offline · the Trade tab', state: view(offline, { kind: 'trades' }, { tab: 'trade' }) },
    { title: 'Offline · no Market tab', state: pane(offline, { tab: 'team' }) },
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
    step('a legendary caught: keep it safe with a passkey', moment({ kind: 'passkey', id: 'passkey', until: null, card: toBattleCard(w.forSale[2]!) })),
    step('sold on the market', moment({ kind: 'market', id: 'market:demo-sold', outcome: 'sold', card: toBattleCard(w.more[2]!), handle: 'misty-lark-18', price: 320, until: now + 15_000 })),
    step('a swap sold: their card is yours', moment({ kind: 'market', id: 'market:demo-swap', outcome: 'sold', card: toBattleCard(w.more[0]!), handle: 'quiet-fern-07', price: 0, until: now + 15_000 })),
    step('a listing came home', moment({ kind: 'market', id: 'market:demo-home', outcome: 'expired', card: toBattleCard(w.more[0]!), handle: null, price: 0, until: now + 15_000 })),
    step('a friendly challenge, won', outcome({
      kind: 'duel', opponent: { kind: 'player', handle: 'soft-otter-42', league: 'Peak' }, lead: toBattleCard(w.rival[0]!), sparks: 3, streak: 2, friendly: true,
    })),
    step('a challenge comes to battle', at({ battle: { ...fight({ kind: 'duel', phase: 'rustle', player: true }), friendly: true } })),
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

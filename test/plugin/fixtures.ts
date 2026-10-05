// A small in-memory Spinlings server for the mod's tests: it answers the routes a first session uses, from real core
// rules, so every answer passes the same tolerant schemas a real server's would. Not a test file itself.
import type { ListingView, MarketWant, MeResponse, StartBattleResponse } from '../../plugin/hooks/core/api.ts'
import { FEATURES } from '../../plugin/hooks/core/api.ts'
import type { Card, Family, NewCard } from '../../plugin/hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { starterTeam, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rollPack } from '../../plugin/hooks/core/packs.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { GENERATOR_VERSION } from '../../plugin/hooks/core/species.ts'
import { seasonOf, utcDay } from '../../plugin/hooks/core/world.ts'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'

export const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
export const ORIGIN = 'https://spinlings.dev'
export const TOKEN = 'tok_' + 'a'.repeat(40)

export type Answer = { status: number; ok: boolean; headers: Record<string, string>; text: string }
export type Call = { method: string; path: string; headers: Record<string, string>; body: string }

const json = (status: number, value: unknown): Answer => ({
  status, ok: status >= 200 && status < 300, headers: { 'content-type': 'application/json' }, text: JSON.stringify(value),
})

export function withIds(cards: NewCard[], prefix: string): Card[] {
  return cards.map((c, i) => ({ ...c, id: `${prefix}${i}` }))
}

export function meFor(now: number, cards: Card[], family: Family): MeResponse {
  const day = utcDay(now)
  return {
    player: {
      handle: 'brave-wren-41', handleRerollFrom: day, sparks: 100, rating: 1000, league: 'Pebble', leaderboard: false,
      joinedDay: day, battles: 0, canTrade: false, team: cards.slice(0, 3).map(c => c.id), wishlist: [], cardsVersion: 1,
      streak: 0, seen: [...new Set(cards.map(c => c.species).filter(s => /^s\d/.test(s)))], rested: false, nextWildAt: 0, nextDuelAt: 0, nextChargeAt: 0,
      stats: { duelWins: 0, duelLosses: 0, playersBeaten: 0, wildWins: 0, catches: 0, speciesCollected: 5, firstFinds: 0, mythicsFound: 0, marketSales: 0 },
    },
    listings: [],
    packs: [
      { id: 'pack-welcome-1', family, source: 'welcome', day },
      { id: 'pack-welcome-2', family: family === 'haiku' ? 'fable' : 'haiku', source: 'welcome', day },
    ],
    notices: [], offers: { incoming: [], outgoing: [] }, gifts: [], now,
  }
}

export type FakeServer = {
  calls: Call[]
  me: MeResponse
  cards: Card[]
  /** every request fails at the network */
  down: boolean
  /** what the sign-in poll answers next: pending until the page is used, then added or done (once) */
  poll: 'pending' | 'added' | 'done'
  /** the account a passkey sign-in hands over */
  other: MeResponse
  /** everyone else's listings on the market */
  listings: ListingView[]
  handle(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Answer
}

export const OTHER_TOKEN = 'tok_' + 'b'.repeat(40)

export function fakeServer(o: { now?: number; family?: Family; difficulty?: number; latestClient?: string; minClient?: string } = {}): FakeServer {
  const now = o.now ?? NOW
  const family = o.family ?? 'opus'
  const rng = rngFromSeed('fake-server')
  const starters = withIds(starterTeam(family, rng, now), 'starter-')
  // a shiny foil and a Mythic, so every frame and stamp the card draws gets drawn
  const special: Card = { ...starters[0]!, id: 'shiny-foil', shiny: true, foil: true, bound: false, origin: 'pack', firstFind: true }
  const mythic: Card = { ...generateMythic({ seed: 'fixture-mythic', dna: 7, now }), id: 'mythic-1' }
  const cards = [...starters, special, mythic]
  const server: FakeServer = {
    calls: [], me: meFor(now, cards, family), cards, down: false, poll: 'pending',
    listings: [{
      id: 'listing-for-sale', seller: 'soft-otter-42', price: 40, day: utcDay(now), state: 'open',
      card: toBattleCard(withIds(rollPack('fable', seasonOf(now), rngFromSeed('market'), now), 'sale-').at(-1)!),
    }],
    other: { ...meFor(now, cards, family), player: { ...meFor(now, cards, family).player, handle: 'misty-lark-18', battles: 31 } },
    handle(url, init = {}) {
      const method = init.method ?? 'GET'
      const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url
      const headers = init.headers ?? {}
      server.calls.push({ method, path, headers, body: init.body ?? '' })
      if (server.down) throw new Error('offline')
      const authed = headers.authorization === `Bearer ${TOKEN}`
      const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {}
      if (method === 'GET' && path === '/v1/version') {
        return json(200, { api: 1, server: '1.0.0', rules: RULES_VERSION, generator: GENERATOR_VERSION, minClient: o.minClient ?? '0.0.1', latestClient: o.latestClient ?? '0.1.0', features: [...FEATURES] })
      }
      if (method === 'GET' && path === '/v1/challenge') return json(200, { challenge: 'challenge-0123456789', difficulty: o.difficulty ?? 4 })
      if (method === 'POST' && path === '/v1/join') return json(200, { token: TOKEN, me: server.me })
      if (method === 'POST' && path === '/v1/auth/start') return json(200, { url: `${ORIGIN}/passkey/signin?p=poll-signin`, pollId: 'poll-signin' })
      if (method === 'GET' && path.startsWith('/v1/auth/poll/')) {
        const status = server.poll
        if (status === 'done') {
          server.poll = 'pending'
          return json(200, { status, token: OTHER_TOKEN, me: server.other })
        }
        return json(200, { status })
      }
      if (!authed && headers.authorization !== `Bearer ${OTHER_TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'no' } })
      if (method === 'POST' && path === '/v1/me/passkey/start') return json(200, { url: `${ORIGIN}/passkey/add?t=ticket-1`, pollId: 'poll-add' })
      if (method === 'GET' && path === '/v1/me/devices') return json(200, { sessions: 1, passkeys: server.poll === 'added' ? 1 : 0 })
      if (method === 'GET' && path === '/v1/leaderboard') return json(200, { top: [{ handle: 'misty-lark-18', league: 'Star', rating: 1744 }] })
      if (method === 'PUT' && path === '/v1/me/leaderboard') {
        server.me = { ...server.me, player: { ...server.me.player, leaderboard: body.optIn === true } }
        return json(200, { leaderboard: body.optIn === true })
      }
      if (method === 'PUT' && path === '/v1/team') {
        server.me = { ...server.me, player: { ...server.me.player, team: body.cardIds as string[] } }
        return json(200, { team: body.cardIds })
      }
      if (method === 'POST' && (path === '/v1/claim' || path === '/v1/redeem')) {
        const got = withIds(rollPack('sonnet', seasonOf(now), rngFromSeed(String(body.code)), now).slice(-1), `gift-${server.cards.length}-`)
        server.cards = [...server.cards, ...got]
        server.me = { ...server.me, player: { ...server.me.player, cardsVersion: server.me.player.cardsVersion + 1 } }
        return json(200, path === '/v1/claim' ? { card: got[0] } : { cards: got, packs: [] })
      }
      if (method === 'POST' && path === '/v1/me/handle') {
        server.me = { ...server.me, player: { ...server.me.player, handle: 'quiet-fern-07', handleRerollFrom: utcDay(now + 7 * 86_400_000) } }
        return json(200, { handle: 'quiet-fern-07', handleRerollFrom: utcDay(now + 7 * 86_400_000) })
      }
      if (method === 'GET' && path === '/v1/me') return json(200, authed ? server.me : server.other)
      if (method === 'GET' && path === '/v1/cards') return json(200, { cards: server.cards, version: server.me.player.cardsVersion })
      if (method === 'POST' && path === '/v1/packs/open') {
        const pack = server.me.packs.find(p => p.id === body.packId)
        if (!pack) return json(404, { error: { code: 'not_found', message: 'no such pack' } })
        const got = withIds(rollPack(pack.family, seasonOf(now), rngFromSeed(pack.id), now), `${pack.id}-`)
        server.cards = [...server.cards, ...got]
        server.me = {
          ...server.me, packs: server.me.packs.filter(p => p.id !== pack.id),
          player: { ...server.me.player, cardsVersion: server.me.player.cardsVersion + 1, seen: [...new Set([...server.me.player.seen, ...got.map(c => c.species)])] },
        }
        return json(200, { cards: got })
      }
      if (method === 'POST' && path === '/v1/battles') {
        const attacker = server.cards.filter(c => server.me.player.team.includes(c.id)).map(toBattleCard)
        const defender = withIds(starterTeam(family === 'opus' ? 'haiku' : 'opus', rngFromSeed('rival'), now), 'rival-').map(toBattleCard)
        const res: StartBattleResponse = {
          id: 'battle-1',
          setup: { seed: 'seed-1', kind: body.kind as 'duel', arena: body.family as Family, rule: 'calm', rules: RULES_VERSION, attacker, defender },
          opponent: { kind: 'rival', name: 'Thistlewick', league: 'Pebble' }, subs: [], firstPossible: [false, false, false],
          startedAt: now, finishAfter: now,
        }
        battle = res
        return json(200, res)
      }
      if (method === 'POST' && path === '/v1/battles/battle-1/finish' && battle) {
        const log = simulateBattle(battle.setup, (body.inputs as number[]) ?? [])
        return json(200, {
          result: log.result, sparks: 10, xp: [], rating: 1010, ratingDelta: 10, catchOptions: [], bounty: null, dailyWinPack: false,
          streak: 1, streakPack: false, tired: [], log,
        })
      }
      if (method === 'POST' && path === '/v1/packs/charge') return json(200, { packs: server.me.packs })
      // the market, the boards, profiles and challenges (0.2.0)
      if (method === 'GET' && path.startsWith('/v1/leaderboards')) {
        const q = new URL(ORIGIN + path).searchParams
        return json(200, {
          board: q.get('board') ?? 'rating', period: q.get('period') ?? 'all', season: seasonOf(now),
          top: [{ rank: 1, handle: 'misty-lark-18', league: 'Star', value: 1744 }, { rank: 2, handle: 'soft-otter-42', league: 'Peak', value: 1600 }],
          me: { rank: 9, handle: server.me.player.handle, league: 'Pebble', value: 1000 },
        })
      }
      if (method === 'GET' && path.startsWith('/v1/market')) {
        const open = server.listings.filter(l => l.state === 'open')
        return json(200, { listings: open, prices: open.map(l => ({ species: l.card.species, sales: [{ day: utcDay(now - 86_400_000), price: 90, rarity: l.card.rarity, shiny: false, foil: false }] })).filter(p => /^s\d/.test(p.species)) })
      }
      if (method === 'POST' && path === '/v1/market') {
        const card = server.cards.find(c => c.id === body.cardId)
        if (!card) return json(404, { error: { code: 'not_found', message: 'no such card' } })
        const listing: ListingView = {
          id: `listing-${server.listings.length + 1}`, seller: server.me.player.handle, card: toBattleCard(card), price: Number(body.price ?? 0),
          ...(body.want ? { want: body.want as MarketWant } : {}), day: utcDay(now), state: 'open',
        }
        server.cards = server.cards.map(c => (c.id === card.id ? { ...c, state: 'escrow' } : c))
        server.me = { ...server.me, listings: [listing, ...(server.me.listings ?? [])], player: { ...server.me.player, cardsVersion: server.me.player.cardsVersion + 1 } }
        return json(200, { listing })
      }
      const buy = /^\/v1\/market\/([^/]+)\/(buy|cancel)$/.exec(path)
      if (method === 'POST' && buy) {
        const listing = [...server.listings, ...(server.me.listings ?? [])].find(l => l.id === buy[1])
        if (!listing || listing.state !== 'open') return json(409, { error: { code: 'conflict', message: 'Already sold' } })
        if (buy[2] === 'cancel') {
          server.me = { ...server.me, listings: (server.me.listings ?? []).filter(l => l.id !== listing.id) }
          return json(200, { listing: { ...listing, state: 'cancelled' } })
        }
        const card: Card = { ...(listing.card as Card), id: `bought-${listing.id}`, xp: 0, bound: false, forTrade: false, origin: 'pack', mintedAt: now, lockedUntil: 0, tiredUntil: 0, state: 'owned' }
        server.listings = server.listings.map(l => (l.id === listing.id ? { ...l, state: 'sold' } : l))
        server.cards = [...server.cards, card]
        server.me = { ...server.me, player: { ...server.me.player, sparks: server.me.player.sparks - listing.price, cardsVersion: server.me.player.cardsVersion + 1 } }
        return json(200, { listing: { ...listing, state: 'sold' }, card, sparks: server.me.player.sparks })
      }
      const player = /^\/v1\/players\/([^/]+)$/.exec(path)
      if (method === 'GET' && player) {
        return json(200, {
          handle: player[1], league: 'Peak', team: server.cards.slice(0, 3).map(toBattleCard), forTrade: [], seenCount: 12,
          stats: { duelWins: 30, duelLosses: 12, playersBeaten: 11, wildWins: 40, catches: 33, speciesCollected: 12, firstFinds: 1, mythicsFound: 0, marketSales: 5 },
        })
      }
      return json(404, { error: { code: 'not_found', message: 'nothing here' } })
    },
  }
  let battle: StartBattleResponse | null = null
  return server
}

/** A store the test owns, so it can look inside. */
export function memoryStore(): Map<string, unknown> {
  return new Map<string, unknown>()
}

/** Releases newer than this mod, for the tests that need a server naming one: the next minor, and the one after. */
export const NEXT = CLIENT_VERSION.replace(/^(\d+)\.(\d+)\..*$/, (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`)
export const AFTER_NEXT = CLIENT_VERSION.replace(/^(\d+)\.(\d+)\..*$/, (_, major: string, minor: string) => `${major}.${Number(minor) + 2}.0`)

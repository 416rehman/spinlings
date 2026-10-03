// A small in-memory Spinlings server for the mod's tests: it answers the routes a first session uses, from real core
// rules, so every answer passes the same tolerant schemas a real server's would. Not a test file itself.
import type { MeResponse, StartBattleResponse } from '../hooks/core/api.ts'
import { FEATURES } from '../hooks/core/api.ts'
import type { Card, Family, NewCard } from '../hooks/core/types.ts'
import { RULES_VERSION, simulateBattle } from '../hooks/core/battle.ts'
import { starterTeam, toBattleCard } from '../hooks/core/cards.ts'
import { generateMythic } from '../hooks/core/mythics.ts'
import { rollPack } from '../hooks/core/packs.ts'
import { rngFromSeed } from '../hooks/core/rng.ts'
import { GENERATOR_VERSION } from '../hooks/core/species.ts'
import { seasonOf, utcDay } from '../hooks/core/world.ts'

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
    },
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
        const got = withIds(rollPack('sonnet', seasonOf(now), rngFromSeed(String(body.code)), now).slice(4), `gift-${server.cards.length}-`)
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

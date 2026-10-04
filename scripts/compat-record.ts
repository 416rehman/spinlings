// Records what this mod sends and what the server answers, for the compatibility suite (SPEC 32). The mod's own
// RemoteBackend (client/remote.ts over client/net.ts, and joinServer for the join) plays a few flows against the
// production app in-process (test/compat/harness.ts: node:sqlite in memory, a fixed clock, seeded random bytes, no
// network), and every exchange is written to test/compat/fixtures/{version}/, one file per flow, with what a server
// makes up (ids, tokens, handles, codes, page links, cursors) turned into placeholders. A frozen copy of the mod's
// response reader goes next to them. test/compat/replay.test.ts replays every version's flows against the current
// server, so a server change that would break a released mod fails there.
//
//   node scripts/compat-record.ts           records the installed mod (CLIENT_VERSION)
//   node scripts/compat-record.ts --force   records it again, only while that version is not yet tagged
//
// A release records its mod in the release pull request (docs/releasing.md); a released version's fixtures never change.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { allCards } from '../plugin/hooks/client/game.ts'
import { RESPONSE_MAX_BYTES } from '../plugin/hooks/client/net.ts'
import { CLIENT_VERSION, createRemoteBackend, joinServer } from '../plugin/hooks/client/remote.ts'
import { BackendError } from '../plugin/hooks/client/types.ts'
import type { Backend } from '../plugin/hooks/client/types.ts'
import { API_ROUTES } from '../plugin/hooks/core/api.ts'
import type { ApiErrorCode, ApiOp, ApiRequest, ApiResponse, MeResponse } from '../plugin/hooks/core/api.ts'
import { simulateBattle } from '../plugin/hooks/core/battle.ts'
import { ECONOMY, finishAfter } from '../plugin/hooks/core/economy.ts'
import { GIFT_CODE_RE } from '../plugin/hooks/core/schemas.ts'
import { familySpecies } from '../plugin/hooks/core/species.ts'
import { traderGiveProblem } from '../plugin/hooks/core/trader.ts'
import type { Card, Family } from '../plugin/hooks/core/types.ts'
import { seasonOf } from '../plugin/hooks/core/world.ts'
import { DAY, ORIGIN, replay, world } from '../test/compat/harness.ts'
import type { BrowserStep, Exchange, Flow, Reader, SetupStep, Step, World } from '../test/compat/harness.ts'
import { perfectInputs } from './e2e.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FIXTURES = join(ROOT, 'test/compat/fixtures')

// ---------- a recording: players driven by the mod, every exchange kept ----------

type Unstamped<T> = T extends unknown ? Omit<T, 'at'> : never

type Mod = {
  readonly family: Family
  token: string | null
  readonly api: Backend
  call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>>
  /** the operation fails with this code */
  fails<K extends ApiOp>(op: K, req: ApiRequest<K>, code: ApiErrorCode): Promise<void>
  /** challenge, proof of work and join, as the mod's first run does it */
  join(): Promise<MeResponse>
}

type Recording = {
  readonly w: World
  readonly steps: Step[]
  mod(name: string, family: Family): Mod
  setup(step: Unstamped<SetupStep>): Promise<void>
  browser(step: Unstamped<BrowserStep>): Promise<void>
}

const ROUTES = (Object.keys(API_ROUTES) as ApiOp[]).map(op => ({
  op, method: API_ROUTES[op].method, re: new RegExp('^' + API_ROUTES[op].path.replace(/:[A-Za-z]+/g, '[^/]+') + '$'),
}))

function opOf(method: string, path: string): ApiOp {
  const hit = ROUTES.find(r => r.method === method && r.re.test(path))
  if (!hit) throw new Error(`${method} ${path} is no API operation`)
  return hit.op
}

function recording(flow: string): Recording {
  const w = world(flow)
  const steps: Step[] = []
  const stamp = () => {
    w.begin(steps.length)
    return w.now()
  }
  return {
    w, steps,
    mod(name, family) {
      const m: Mod = {
        family, token: null,
        api: createRemoteBackend({
          origin: ORIGIN,
          async fetch(url, init) {
            const at = stamp()
            const { pathname, search } = new URL(url)
            const res = await w.send(name, init.method, pathname + search, init.headers, init.body)
            const kept: Record<string, string> = {}
            for (const h of ['content-type', 'retry-after']) if (res.headers[h] !== undefined) kept[h] = res.headers[h]!
            steps.push({
              op: opOf(init.method, pathname), player: name, at,
              request: { method: init.method, path: pathname + search, headers: { ...init.headers }, ...(init.body === undefined ? {} : { body: JSON.parse(init.body) as unknown }) },
              response: { status: res.status, headers: kept, body: JSON.parse(res.text) as unknown },
            })
            return { status: res.status, ok: res.status >= 200 && res.status < 300, headers: res.headers, text: res.text }
          },
          token: async () => m.token,
          now: async () => w.now(),
          after: () => ({ cancel() {} }),
          sent: () => {},
        }),
        call: (op, req) => m.api.call(op, req),
        async fails(op, req, code) {
          try {
            await m.api.call(op, req)
          } catch (err) {
            if (err instanceof BackendError && err.code === code) return
            throw err
          }
          throw new Error(`${name}: ${op} should have failed with ${code}`)
        },
        async join() {
          const joined = await joinServer(m.api, family, () => new Promise(done => setImmediate(done)))
          m.token = joined.token
          return joined.me
        },
      }
      return m
    },
    async setup(s) {
      const step = { ...s, at: stamp() } as SetupStep
      await w.setup(step)
      steps.push(step)
    },
    async browser(s) {
      const step = { ...s, at: stamp() } as BrowserStep
      await w.browser(step)
      steps.push(step)
    },
  }
}

// ---------- what the mod does, flow by flow ----------

const ids = (cards: readonly { id: string }[]) => cards.map(c => c.id)

/** Owned, unbound, unlocked, off the team and of a season species: cards a player may spend. */
async function freeCards(r: Recording, m: Mod): Promise<Card[]> {
  const team = (await m.call('me', {})).player.team
  return (await allCards(m.api)).cards.filter(c => !c.bound && c.state === 'owned' && c.lockedUntil <= r.w.now() && !team.includes(c.id) && /^s\d/.test(c.species))
}

async function openAll(m: Mod): Promise<void> {
  for (const p of (await m.call('me', {})).packs) await m.call('openPack', { packId: p.id })
}

/** One battle as the mod plays it: start, simulate with the server's setup, press on Perfect rounds, wait, finish. */
async function battle(r: Recording, m: Mod, kind: 'wild' | 'duel', o: { early?: boolean; handle?: string } = {}) {
  const start = await m.call('startBattle', { kind, family: m.family, ...(o.handle ? { handle: o.handle } : {}) })
  const inputs = perfectInputs(start.setup)
  if (o.early) await m.fails('finishBattle', { battleId: start.id, inputs }, 'conflict')
  r.w.until(Math.max(start.finishAfter, finishAfter(start.startedAt, simulateBattle(start.setup, inputs).rounds.length)))
  const fin = await m.call('finishBattle', { battleId: start.id, inputs })
  return { start, fin }
}

type FlowSpec = { flow: string; about: string; play(r: Recording): Promise<void> }

const FLOWS: FlowSpec[] = [
  {
    flow: 'account',
    about: 'the handshake, a join, and the player\'s own settings',
    async play(r) {
      const a = r.mod('a', 'opus')
      await a.call('version', {})
      const { season } = await a.call('world', {})
      await a.call('season', { season })
      await a.fails('season', { season: season + 1 }, 'not_found')
      const me = await a.join()
      await a.call('me', {})
      await allCards(a.api)
      await a.call('devices', {})
      await a.call('setTeam', { cardIds: [...me.player.team].reverse() })
      await a.call('setWishlist', { species: ids(familySpecies(season, 'fable').slice(0, 2)) })
      await a.call('setLeaderboard', { optIn: true })
      await a.call('leaderboard', {})
      const { handle } = await a.call('rerollHandle', {})
      await a.fails('rerollHandle', {}, 'rate_limited')
      await a.call('profile', { handle })
      await a.fails('profile', { handle: 'nobody-here-00' }, 'not_found')
      r.w.tick(ECONOMY.handleRerollMs)
      const chosen = await a.call('rerollHandle', { handle: 'moss_keeper' })
      await a.call('rerollHandle', { handle: 'MOSS_KEEPER' })
      await a.call('me', {})
      await a.call('profile', { handle: chosen.handle })
      await a.call('setLeaderboard', { optIn: false })
    },
  },
  {
    flow: 'collection',
    about: 'packs, the team, fusing, recycling, crafting, listing and the Wandering Trader',
    async play(r) {
      const a = r.mod('a', 'sonnet')
      const me = await a.join()
      await a.fails('chargePack', { family: 'sonnet' }, 'rate_limited')
      r.w.tick(ECONOMY.packs.chargeSpacingMs)
      await a.call('chargePack', { family: 'sonnet' })
      await a.fails('chargePack', { family: 'sonnet' }, 'rate_limited')
      await a.fails('buyPack', { family: 'opus' }, 'insufficient_sparks')
      await r.setup({ setup: 'trust', player: 'a' })
      for (const family of ['opus', 'fable'] as const) await a.call('buyPack', { family })
      await openAll(a)
      await a.fails('openPack', { packId: 'nosuchpackanywhere00000000' }, 'not_found')
      const [x, y, z] = await freeCards(r, a)
      await a.fails('fuse', { cardId: x!.id, otherId: x!.id }, 'bad_request')
      await a.call('fuse', { cardId: x!.id, otherId: y!.id })
      await a.call('recycle', { cardId: z!.id })
      await a.fails('recycle', { cardId: me.player.team[0]! }, 'not_allowed')
      const plain = familySpecies(seasonOf(r.w.now()), 'opus').find(s => !s.legendary)!
      await a.call('craft', { speciesId: plain.id, rarity: 'common' })
      await a.fails('craft', { speciesId: plain.id, rarity: 'legendary' }, 'bad_request')
      const pool = await freeCards(r, a)
      await a.call('setForTrade', { cardId: pool[0]!.id, forTrade: true })
      await a.call('setForTrade', { cardId: pool[0]!.id, forTrade: false })
      await a.fails('setTeam', { cardIds: ['nosuchcardanywhere0000000a'] }, 'not_found')
      for (let day = 0; day < 8; day++, r.w.tick(DAY)) {
        for (const deal of (await a.call('trader', {})).deals) {
          const give = pool.filter(k => (!deal.give.family || k.family === deal.give.family) && (!deal.give.rarity || k.rarity === deal.give.rarity)).slice(0, deal.give.count)
          if (traderGiveProblem(deal, give, r.w.now())) continue
          await a.call('traderDeal', { dealId: deal.id, cardIds: ids(give) })
          await a.fails('traderDeal', { dealId: deal.id, cardIds: ids(give) }, 'conflict')
          return
        }
      }
      throw new Error('no Trader deal could be paid within a week')
    },
  },
  {
    flow: 'pages',
    about: 'a collection too big for one answer, read a page at a time',
    async play(r) {
      const a = r.mod('a', 'haiku')
      await a.join()
      await r.setup({ setup: 'cards', player: 'a', count: 900 })
      await allCards(a.api)
      if (r.steps.filter(s => 'op' in s && s.op === 'cards').length < 2) throw new Error('the collection came in one page')
    },
  },
  {
    flow: 'battles',
    about: 'wild battles up to a catch, the minimum duration and spacing, a Rival duel, and a finish asked twice',
    async play(r) {
      const a = r.mod('a', 'fable')
      await a.join()
      await openAll(a)
      for (let i = 0; ; i++) {
        if (i === 12) throw new Error('no catch in 12 wild battles')
        r.w.until((await a.call('me', {})).player.nextWildAt)
        const { start, fin } = await battle(r, a, 'wild', { early: i === 0 })
        if (i === 0) await a.fails('startBattle', { kind: 'wild', family: a.family }, 'rate_limited')
        if (!fin.catchOptions.length) continue
        await a.call('catchCreature', { battleId: start.id, index: 0 })
        await a.fails('catchCreature', { battleId: start.id, index: 0 }, 'conflict')
        break
      }
      r.w.until((await a.call('me', {})).player.nextDuelAt)
      const duel = await battle(r, a, 'duel')
      await a.call('finishBattle', { battleId: duel.start.id, inputs: [] })
      await a.call('me', {})
    },
  },
  {
    flow: 'social',
    about: 'profiles, the board, the leaderboard, offers (declined, cancelled, countered and accepted, expired), gifts, claims and a drop code',
    async play(r) {
      const a = r.mod('a', 'opus'), b = r.mod('b', 'haiku'), c = r.mod('c', 'fable')
      await a.join()
      const hb = (await b.join()).player.handle
      await r.setup({ setup: 'trust', player: 'a' })
      await r.setup({ setup: 'trust', player: 'b' })
      for (let i = 0; i < 3; i++) await a.call('buyPack', { family: 'sonnet' })
      for (let i = 0; i < 2; i++) await b.call('buyPack', { family: 'fable' })
      await openAll(a)
      await openAll(b)
      const mine = await freeCards(r, a)
      const theirs = (await freeCards(r, b)).filter(k => !mine.some(m => m.species === k.species))
      const [m1, m2, m3] = mine
      const t1 = theirs[0]!
      await b.call('setForTrade', { cardId: t1.id, forTrade: true })
      await a.call('setForTrade', { cardId: m1!.id, forTrade: true })
      await a.call('setWishlist', { species: [t1.species] })
      await b.call('setWishlist', { species: [m1!.species] })
      await a.call('profile', { handle: hb })
      await a.call('board', {})
      await a.call('setLeaderboard', { optIn: true })
      await b.call('leaderboard', {})

      const send = async (give: Card[], get: Card[]) => (await a.call('offer', { to: hb, give: ids(give), get: ids(get) })).offer
      const declined = await send([m2!], [])
      await b.call('me', {})
      await b.call('declineOffer', { offerId: declined.id })
      await b.fails('declineOffer', { offerId: declined.id }, 'conflict')
      const cancelled = await send([m2!], [])
      await b.fails('cancelOffer', { offerId: cancelled.id }, 'not_found')
      await a.call('cancelOffer', { offerId: cancelled.id })
      const countered = await send([m2!], [t1])
      const counter = (await b.call('counterOffer', { offerId: countered.id, give: [t1.id], get: [m1!.id] })).offer
      await a.call('me', {})
      await a.call('acceptOffer', { offerId: counter.id })
      const lapsing = await send([m3!], [])
      r.w.tick(4 * DAY)
      await b.fails('acceptOffer', { offerId: lapsing.id }, 'expired')

      const g1 = (await a.call('gift', { cardId: m2!.id })).gift
      await a.call('cancelGift', { code: g1.code })
      await a.fails('cancelGift', { code: g1.code }, 'conflict')
      const g2 = (await a.call('gift', { cardId: m2!.id })).gift
      await a.call('me', {})
      await c.join()
      await c.fails('claim', { code: 'quiet-otter-lamp-0000' }, 'not_found')
      await c.call('claim', { code: g2.code })
      await r.setup({ setup: 'drop', code: 'COMPAT', reward: { type: 'pack', count: 1 } })
      await c.call('redeem', { code: 'compat' })
      await c.fails('redeem', { code: 'COMPAT' }, 'conflict')
      await a.call('me', {})
      await b.call('me', {})
    },
  },
  {
    flow: 'market',
    about: 'the market (listed, browsed, bought for sparks and for a card, refused, cancelled), a challenge by handle and the leaderboards',
    async play(r) {
      const a = r.mod('a', 'opus'), b = r.mod('b', 'haiku')
      const ha = (await a.join()).player.handle
      await b.join()
      await r.setup({ setup: 'trust', player: 'a' })
      await r.setup({ setup: 'trust', player: 'b' })
      for (let i = 0; i < 2; i++) await a.call('buyPack', { family: 'sonnet' })
      await b.call('buyPack', { family: 'fable' })
      await openAll(a)
      await openAll(b)
      const [x, y, z] = await freeCards(r, a)
      const fit = (await freeCards(r, b))[0]!
      const sold = (await a.call('listCard', { cardId: x!.id, price: 25 })).listing
      await a.fails('listCard', { cardId: x!.id, price: 25 }, 'not_allowed')
      const swap = (await a.call('listCard', { cardId: y!.id, want: { family: fit.family } })).listing
      await a.call('me', {})
      await b.call('market', { sort: 'cheapest' })
      await a.fails('buyListing', { listingId: sold.id }, 'not_allowed')
      await b.call('buyListing', { listingId: sold.id })
      await b.fails('buyListing', { listingId: sold.id }, 'conflict')
      await b.fails('buyListing', { listingId: swap.id }, 'bad_request')
      await b.call('buyListing', { listingId: swap.id, cardId: fit.id })
      const back = (await a.call('listCard', { cardId: z!.id, price: 3 })).listing
      await b.fails('cancelListing', { listingId: back.id }, 'not_found')
      await a.call('cancelListing', { listingId: back.id })
      await a.call('rankings', { board: 'sales', period: 'season' })
      r.w.until((await b.call('me', {})).player.nextDuelAt)
      await battle(r, b, 'duel', { handle: ha })
      await b.call('profile', { handle: ha })
      await b.call('leaderboard', {})
    },
  },
  {
    flow: 'devices',
    about: 'a passkey saved and used to sign in on another machine, reset access, and deleting the account',
    async play(r) {
      const b = r.mod('b', 'haiku'), laptop = r.mod('laptop', 'haiku')
      await b.join()
      const add = await b.call('passkeyStart', {})
      await b.call('authPoll', { pollId: add.pollId })
      await r.browser({ browser: 'passkey-add', player: 'b', url: add.url })
      await b.call('authPoll', { pollId: add.pollId })
      const start = await laptop.call('authStart', {})
      await laptop.call('authPoll', { pollId: start.pollId })
      await r.browser({ browser: 'passkey-signin', player: 'laptop', url: start.url })
      const done = await laptop.call('authPoll', { pollId: start.pollId })
      if (done.status !== 'done') throw new Error(`the sign-in poll answered ${done.status}`)
      laptop.token = done.token
      await laptop.fails('authPoll', { pollId: start.pollId }, 'not_found')
      await laptop.call('devices', {})
      await b.call('me', {})
      const { token } = await laptop.call('resetToken', {})
      await b.fails('me', {}, 'unauthorized')
      b.token = token
      await b.call('devices', {})
      await b.call('deleteMe', {})
      await b.fails('me', {}, 'unauthorized')
    },
  },
]

// ---------- placeholders, trimming and the file format ----------

const HANDLE_KEYS = new Set(['handle', 'from', 'to', 'claimedBy', 'discoveredBy', 'seller'])
const ID = /^[a-z2-7]{26}$/
const EXACT = /^<[a-z]+:\d+>$/

/** The kind of placeholder a value a server made up gets, or null for a value every run shares. */
function kindOf(op: string, key: string, path: string, v: string): string | null {
  if (key === 'token') return 'token'
  if (key === 'challenge') return 'challenge'
  if (key === 'pollId') return 'poll'
  if (key === 'url') return 'url'
  if (key === 'next') return 'cursor'
  if (HANDLE_KEYS.has(key)) return 'handle'
  if (GIFT_CODE_RE.test(v)) return 'gift'
  if (!ID.test(v)) return null
  if (/\.packs\[\d+\]\.id$/.test(path)) return 'pack'
  if (/\.notices\[\d+\]\.id$/.test(path)) return 'notice'
  if (/(\.offer|\.incoming\[\d+\]|\.outgoing\[\d+\])\.id$/.test(path)) return 'offer'
  if (/(\.listing|\.listings\[\d+\])\.id$/.test(path)) return 'listing'
  if (op === 'startBattle' && path === '$.id') return 'battle'
  return 'card'
}

/** Every string in a JSON value through `f`, with its key (an array item's is its array's) and path. */
function walk(v: unknown, f: (s: string, key: string, path: string) => string, key = '', path = '$'): unknown {
  if (typeof v === 'string') return f(v, key, path)
  if (Array.isArray(v)) return v.map((x, i) => walk(x, f, key, `${path}[${i}]`))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, f, k, `${path}.${k}`)]))
  return v
}

/**
 * Names each made-up value at its first appearance in an answer, then writes every later appearance of it (in
 * requests, headers, paths and other answers, inside text too) as that name. A join's nonce becomes `<pow>`.
 */
function normalize(steps: readonly Step[]): Step[] {
  const names = new Map<string, string>()
  const counts = new Map<string, number>()
  const name = (kind: string, raw: string) => {
    if (!names.has(raw)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
      names.set(raw, `<${kind}:${counts.get(kind)}>`)
    }
    return names.get(raw)!
  }
  const known = (s: string) => {
    if (names.has(s)) return names.get(s)!
    let out = s
    for (const [raw, p] of [...names].sort((x, y) => y[0].length - x[0].length)) if (raw.length >= 8) out = out.split(raw).join(p)
    return out
  }
  return steps.map((step): Step => {
    if ('setup' in step) return step
    if ('browser' in step) return { ...step, url: known(step.url) }
    const { request: q, response: a } = step
    const request = {
      method: q.method,
      path: known(q.path),
      headers: Object.fromEntries(Object.entries(q.headers).map(([k, v]) => [k, known(v)])),
      ...(q.body === undefined ? {} : { body: walk(q.body, (s, key) => (step.op === 'join' && key === 'nonce' ? '<pow>' : known(s))) }),
    }
    const named = walk(a.body, (s, key, path) => {
      const kind = kindOf(step.op, key, path, s)
      return kind ? name(kind, s) : s
    })
    return { ...step, request, response: { ...a, body: walk(named, s => (EXACT.test(s) ? s : known(s))) } }
  })
}

/** Arrays longer than this keep their first few items in the file (a page of cards is a quarter of a megabyte). */
const TRIM_OVER = 40
const TRIM_TO = 3

function trim(v: unknown, path: string, out: Record<string, number>): unknown {
  if (Array.isArray(v)) {
    if (v.length > TRIM_OVER) out[path] = v.length
    return v.slice(0, v.length > TRIM_OVER ? TRIM_TO : v.length).map((x, i) => trim(x, `${path}[${i}]`, out))
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, `${path}.${k}`, out)]))
  return v
}

function trimmed(step: Step): Step {
  if (!('op' in step)) return step
  const cut: Record<string, number> = {}
  const body = trim(step.response.body, '$', cut)
  return { ...step, response: { ...step.response, body, ...(Object.keys(cut).length ? { trimmed: cut } : {}) } }
}

/** JSON, one line wherever it fits in 120 columns. `used` is how much of the line is taken already. */
function format(v: unknown, indent = '', used = indent.length): string {
  const flat = JSON.stringify(v)
  if (v === null || typeof v !== 'object' || used + flat.length < 120) return flat
  const inner = indent + '  '
  if (Array.isArray(v)) return `[\n${v.map(x => inner + format(x, inner)).join(',\n')}\n${indent}]`
  const items = Object.entries(v).map(([k, x]) => {
    const head = `${inner}${JSON.stringify(k)}: `
    return head + format(x, inner, head.length)
  })
  return `{\n${items.join(',\n')}\n${indent}}`
}

/** Plays every flow with the installed mod and answers the fixtures, placeholders in and long arrays cut. */
export async function recordFlows(): Promise<Flow[]> {
  const flows: Flow[] = []
  for (const spec of FLOWS) {
    const r = recording(spec.flow)
    try {
      await spec.play(r)
    } catch (err) {
      if (err instanceof Error) err.message = `${spec.flow}: ${err.message}`
      throw err
    } finally {
      r.w.close()
    }
    const flow: Flow = { client: CLIENT_VERSION, flow: spec.flow, about: spec.about, steps: normalize(r.steps).map(trimmed) }
    const text = JSON.stringify(flow)
    for (const [leak, what] of [[/[0-9a-f]{64}/, 'a session token'], [/Bearer (?!<token:)/, 'a bearer token'], [/\?t=/, 'a page ticket']] as const) {
      if (leak.test(text)) throw new Error(`${spec.flow}: ${what} was left in the recording`)
    }
    flows.push(flow)
  }
  return flows
}

// ---------- the frozen reader ----------

/** What client/net.ts readAnswer requires of every answer besides its schema; the recorder checks net.ts still says so. */
const JSON_CONTENT_TYPE = /^application\/json(\s*;|$)/i
const RETRY_AFTER = /^\s*\d{1,6}\s*$/

/**
 * plugin/hooks/core/schemas.ts as it is now, runnable from the fixtures folder: its type imports and function
 * imports point at the live modules, its imported values (a format's RegExp) are written in, and readAnswer's
 * other checks follow at the end.
 */
async function frozenReader(version: string): Promise<string> {
  const net = readFileSync(join(ROOT, 'plugin/hooks/client/net.ts'), 'utf8')
  for (const re of [JSON_CONTENT_TYPE, RETRY_AFTER]) if (!net.includes(String(re))) throw new Error(`client/net.ts no longer checks ${re}: update the recorder`)
  const core = join(ROOT, 'plugin/hooks/core')
  const src = readFileSync(join(core, 'schemas.ts'), 'utf8')
  const IMPORT = /^import (type )?\{([^}]*)\} from '\.\/([\w-]+\.ts)'\n/gm
  const swaps = new Map<string, string>()
  for (const m of src.matchAll(IMPORT)) {
    const live = `../../../../plugin/hooks/core/${m[3]}`
    if (m[1]) {
      swaps.set(m[0], `import type {${m[2]}} from '${live}'\n`)
      continue
    }
    const mod = (await import(pathToFileURL(join(core, m[3]!)).href)) as Record<string, unknown>
    const inlined: string[] = [], imported: string[] = []
    for (const n of m[2]!.split(',').map(s => s.trim()).filter(Boolean)) {
      const v = mod[n]
      if (v instanceof RegExp) inlined.push(`const ${n} = ${String(v)}\n`)
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') inlined.push(`const ${n} = ${JSON.stringify(v)}\n`)
      else imported.push(n)
    }
    swaps.set(m[0], (imported.length ? `import { ${imported.join(', ')} } from '${live}'\n` : '') + inlined.join(''))
  }
  return [
    `// The ${version} mod's response reader, frozen for test/compat/replay.test.ts (SPEC 32): plugin/hooks/core/schemas.ts`,
    `// as ${version} shipped it, written by scripts/compat-record.ts. Only the imports differ (values written in, types and`,
    '// functions from the live modules), and the other checks of client/net.ts readAnswer follow at the end. Never edit it.',
    '',
    src.replace(IMPORT, m => swaps.get(m)!).trimEnd(),
    '',
    `// ---------- what client/net.ts readAnswer also required of every answer in ${version} ----------`,
    '',
    `export const RESPONSE_MAX_BYTES = ${RESPONSE_MAX_BYTES}`,
    `export const JSON_CONTENT_TYPE = ${String(JSON_CONTENT_TYPE)}`,
    `export const RETRY_AFTER = ${String(RETRY_AFTER)}`,
    '',
  ].join('\n')
}

// ---------- the command line ----------

async function main(args: string[]): Promise<void> {
  const version = CLIENT_VERSION
  const dir = join(FIXTURES, version)
  const shown = `test/compat/fixtures/${version}`
  if (existsSync(dir) && !args.includes('--force')) {
    throw new Error(`${shown} exists. A released mod's fixtures never change: bump the version first, or pass --force while ${version} is not yet tagged.`)
  }
  const flows = await recordFlows()
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'schemas.ts'), await frozenReader(version))
  for (const f of flows) writeFileSync(join(dir, `${f.flow}.json`), format(f) + '\n')

  const reader = (await import(pathToFileURL(join(dir, 'schemas.ts')).href)) as Reader
  for (const f of flows) {
    const problems = await replay(f, reader)
    if (problems.length) throw new Error(`${f.flow} does not replay against this server:\n${problems.join('\n')}`)
  }

  const exchanges = flows.flatMap(f => f.steps.filter((s): s is Exchange => 'op' in s))
  for (const f of flows) console.log(`${f.flow.padEnd(12)} ${f.steps.filter(s => 'op' in s).length} exchanges`)
  console.log('')
  for (const op of Object.keys(API_ROUTES)) {
    const all = exchanges.filter(e => e.op === op)
    const ok = all.filter(e => e.response.status < 300).length
    console.log(`${op.padEnd(16)} ${String(all.length).padStart(3)}${all.length > ok ? `  (${all.length - ok} refused)` : ''}`)
  }
  const missing = Object.keys(API_ROUTES).filter(op => !exchanges.some(e => e.op === op && e.response.status < 300))
  if (missing.length) throw new Error(`never answered successfully: ${missing.join(', ')}`)
  console.log(`\n${exchanges.length} exchanges written to ${shown}, and each flow replays against this server`)
}

const self = fileURLToPath(import.meta.url)
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && same(resolve(process.argv[1]), self)) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : err)
    process.exitCode = 1
  })
}

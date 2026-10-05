// The compatibility suite's world (SPEC 32), shared by the recorder (scripts/compat-record.ts) and the replay
// (replay.test.ts): the production app in-process over an in-memory node:sqlite, its clock fixed per step and its
// random bytes drawn from a seeded stream of each step's own, so a recording and its replay see the same server.
// A fixture is a flow of steps: the mod's own exchanges, plus named setup and browser steps that the current code
// carries out (a database shortcut, a passkey ceremony), since neither is something the mod sends.
//
// Placeholders: every id, token, handle, gift code, poll id, page URL and cursor a server makes up is written as
// `<kind:n>`. The replay binds each one from the current server's answer at the place it first appeared, and fills
// it into later requests; a join's nonce is `<pow>`, solved afresh.
// When a smaller pack omits a card the recorded mod later selected, supplemental read-only collection GETs let
// the replay select an available replacement. These are replay bookkeeping, not added historical requests or a
// change to the mod's wire behavior; every recorded request and its status/reader/shape checks still run.
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import type { CardsResponse, ListingView, MarketWant, OpenPackResponse, TraderDealView } from '../../plugin/hooks/core/api.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { wantMatches } from '../../plugin/hooks/core/market.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { proofBits, sha256 } from '../../plugin/hooks/core/sha256.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { insertStmts, planDrop } from '../../scripts/admin/drop.ts'
import { createApp } from '../../server/src/app.ts'
import { hashToken } from '../../server/src/auth.ts'
import { stmt } from '../../server/src/db.ts'
import type { Db } from '../../server/src/db.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { openDatabase } from '../../server/src/node.ts'
import { softAuthenticator } from '../server/passkeys-helpers.ts'
import type { Authenticator } from '../server/passkeys-helpers.ts'

/** What the mod is pointed at; nothing ever leaves the process. */
export const ORIGIN = 'http://localhost:8787'
const SECRET = 'compat-secret-not-for-production-0123456789'
/** Proof-of-work bits: low, so a join takes a moment. */
export const DIFFICULTY = 8
/** 2026-10-02 12:00 UTC: season 1, day 2. */
export const T0 = Date.UTC(2026, 9, 2, 12)
export const DAY = 86_400_000

export type SentRequest = { method: string; path: string; headers: Record<string, string>; body?: unknown }
/** The answer as kept: its status, the headers the mod reads (content-type, retry-after) and the JSON body. */
export type KeptAnswer = { status: number; headers: Record<string, string>; body: unknown; /** arrays cut short in the file: path to full length */ trimmed?: Record<string, number> }
export type Exchange = { op: string; player: string; at: number; request: SentRequest; response: KeptAnswer }
export type SetupStep =
  /** past the trust gate (3 days old, 10 battles) with 5000 sparks, straight in the database */
  | { setup: 'trust'; player: string; at: number }
  /** this many plain commons minted straight into the collection */
  | { setup: 'cards'; player: string; count: number; at: number }
  /** a live drop code with this reward (scripts/admin/drop.ts) */
  | { setup: 'drop'; code: string; reward: unknown; at: number }
/** The player's browser on a page the mod opened: a soft passkey saved (add) or used (signin). */
export type BrowserStep = { browser: 'passkey-add' | 'passkey-signin'; player: string; url: string; at: number }
export type Step = Exchange | SetupStep | BrowserStep
export type Flow = { client: string; flow: string; about: string; steps: Step[] }

/** A recorded version's own reader: test/compat/fixtures/{version}/schemas.ts. */
export type Reader = {
  RESPONSE_SCHEMAS: Readonly<Record<string, unknown>>
  parseResponse(op: string, body: unknown): unknown
  parseApiError(body: unknown): { error: { code: string } }
  RESPONSE_MAX_BYTES: number
  JSON_CONTENT_TYPE: RegExp
  RETRY_AFTER: RegExp
}

export type Answer = { status: number; headers: Record<string, string>; text: string }

/** Random bytes from a seed, as SHA-256 blocks in counter mode: the same stream on every machine and Node version. */
export function randomStream(seed: string): (n: number) => Uint8Array {
  let block = new Uint8Array(0), at = 0, count = 0
  return n => {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      if (at === block.length) {
        block = sha256(`${seed}#${count++}`)
        at = 0
      }
      out[i] = block[at++]!
    }
    return out
  }
}

export type World = {
  readonly db: Db
  now(): number
  tick(ms: number): void
  /** moves to `at` unless the clock is already past it */
  until(at: number): void
  /** step `i` begins: a random stream of its own and, when replaying, the time it was recorded at */
  begin(i: number, at?: number): void
  /** one request from a player's machine; each player has an address of its own */
  send(player: string, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Answer>
  setup(step: SetupStep): Promise<void>
  browser(step: BrowserStep): Promise<void>
  close(): void
}

export function world(flow: string): World {
  const { db, sqlite } = openDatabase(':memory:')
  let now = T0
  let random = randomStream(`${flow}/start`)
  const app = createApp({ db, now: () => now, randomBytes: n => random(n), log: () => {}, config: { secret: SECRET, difficulty: DIFFICULTY } })
  const ips = new Map<string, string>()
  /** each player's latest session token, for the setup steps */
  const tokens = new Map<string, string>()
  let authenticator: Authenticator | null = null

  const ipOf = (player: string) => {
    if (!ips.has(player)) ips.set(player, `198.51.100.${ips.size + 1}`)
    return ips.get(player)!
  }
  const playerId = async (player: string) => {
    const token = tokens.get(player)
    if (!token) throw new Error(`setup: ${player} has no session yet`)
    const row = await db.get<{ player_id: string }>('SELECT player_id FROM sessions WHERE token_hash = ?', hashToken(token))
    if (!row) throw new Error(`setup: ${player}'s session is gone`)
    return row.player_id
  }

  const self: World = {
    db,
    now: () => now,
    tick: ms => { now += ms },
    until: at => { now = Math.max(now, at) },
    begin(i, at) {
      random = randomStream(`${flow}/${i}`)
      if (at !== undefined) now = at
    },
    async send(player, method, path, headers, body) {
      const bearer = /^Bearer (\S+)$/.exec(headers.authorization ?? '')
      if (bearer) tokens.set(player, bearer[1]!)
      const res = await app(new Request(ORIGIN + path, { method, headers, ...(body === undefined ? {} : { body }) }), { ip: ipOf(player) })
      const answer: Answer = { status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() }
      if (res.ok && /json/.test(answer.headers['content-type'] ?? '')) {
        const token = (JSON.parse(answer.text) as { token?: unknown }).token
        if (typeof token === 'string') tokens.set(player, token)
      }
      return answer
    },
    async setup(step) {
      if (step.setup === 'trust') {
        await db.batch([stmt('UPDATE players SET battles = 10, joined = ?, sparks = 5000 WHERE id = ?', utcDay(now - 3 * DAY), await playerId(step.player))])
      } else if (step.setup === 'cards') {
        const fresh = Array.from({ length: step.count }, (_, i) => mintFor(FAMILIES[i % FAMILIES.length]!, 'common', rngFromSeed(`${flow}/cards/${i}`), now, 'pack'))
        const minted = await mintCards({ db, now, randomBytes: random }, await playerId(step.player), fresh)
        await db.batch(minted.stmts)
      } else {
        const plan = planDrop({ code: step.code, reward: step.reward, starts: now - DAY, ends: now + 30 * DAY }, { now, randomBytes: random })
        await db.batch(insertStmts(plan.rows))
      }
    },
    async browser(step) {
      authenticator ??= await softAuthenticator()
      const url = new URL(step.url)
      if (url.origin !== ORIGIN) throw new Error(`${step.browser}: the page is not on the server`)
      const page = await self.send(step.player, 'GET', url.pathname + url.search, { accept: 'text/html' })
      if (page.status !== 200) throw new Error(`${step.browser}: the page answered ${page.status}`)
      const { ticket, options } = pageData(page.text)
      const add = step.browser === 'passkey-add'
      const proof = add ? await authenticator.create(options, ORIGIN) : await authenticator.get(options, ORIGIN)
      const posted = await self.send(step.player, 'POST', add ? '/passkey/add/finish' : '/passkey/signin/finish',
        { 'content-type': 'application/json' }, JSON.stringify({ ticket, ...proof }))
      if (posted.status !== 200) throw new Error(`${step.browser}: the page's finish answered ${posted.status}`)
    },
    close: () => sqlite.close(),
  }
  return self
}

/** The passkey page's data attributes, as its script reads them. */
function pageData(html: string): { ticket: string; options: never } {
  const attr = (name: string) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(html)
    if (!m) throw new Error(`the passkey page has no ${name}`)
    return m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  }
  return { ticket: attr('data-ticket'), options: JSON.parse(attr('data-options')) as never }
}

// ---------- outcomes loosened on purpose ----------

/**
 * A recorded exchange whose outcome this server changes on purpose, in the mod's favour: a refusal that now goes
 * through because a rule was dropped (SPEC 8: no trust gate, no trade lock, no fee). The replay accepts exactly
 * this step answering `now` instead of `was`, still checks the mod can read the new answer, and carries on. Every
 * entry names its reason; an entry no replay used fails replay.test.ts, so the list never outlives its fixtures.
 */
export type Loosened = { client: string; flow: string; step: number; op: string; was: number; now: number; reason: string }

/**
 * Empty so far: the recorded 0.1.0 flows set players past the old trust gate in the database first (`setup: trust`),
 * and record no exchange that a lock or a fee refused, so every one of their outcomes still holds exactly.
 */
export const LOOSENED: readonly Loosened[] = []

// ---------- the replay ----------

const PLACEHOLDER = /<([a-z]+):(\d+)>/g
const EXACT = /^<[a-z]+:\d+>$/

class Unbound extends Error {}

/** A recorded request with every placeholder filled from what the current server answered earlier in the flow. */
function fill<T>(v: T, bound: ReadonlyMap<string, string>): T {
  if (typeof v === 'string') {
    return v.replace(PLACEHOLDER, p => {
      const got = bound.get(p)
      if (got === undefined) throw new Unbound(`${p} never appeared in this server's answers`)
      return got
    }) as T
  }
  if (Array.isArray(v)) return v.map(x => fill(x, bound)) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, bound)])) as T
  return v
}

/** Known list entities follow their IDs, never their position. Missing pack cards wait for an explicit selection. */
export function bindAnswer(rec: unknown, cur: unknown, bound: Map<string, string>, omitted: ReadonlySet<string> = new Set()): void {
  if (typeof rec === 'string') {
    if (EXACT.test(rec) && !bound.has(rec) && !omitted.has(rec) && typeof cur === 'string') bound.set(rec, cur)
  } else if (Array.isArray(rec)) {
    if (Array.isArray(cur)) rec.forEach((x, i) => {
      const id = x && typeof x === 'object' ? x.id : undefined
      if (typeof id === 'string' && omitted.has(id)) return
      const known = typeof id === 'string' ? bound.get(id) : undefined
      const actual = known === undefined ? cur[i] : cur.find(v => v && typeof v === 'object' && v.id === known)
      if (actual === undefined) return
      // An unseen item must not acquire the identity of a different entity already returned by an action.
      if (known === undefined && actual && typeof actual === 'object' && typeof actual.id === 'string'
        && [...bound].some(([key, value]) => key !== id && value === actual.id)) return
      bindAnswer(x, actual, bound, omitted)
    })
  } else if (rec && typeof rec === 'object' && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    for (const [k, x] of Object.entries(rec)) if (Object.hasOwn(cur, k)) bindAnswer(x, (cur as Record<string, unknown>)[k], bound, omitted)
  }
}

const cardReferences = (value: unknown): string[] => [...new Set(JSON.stringify(value).match(/<card:\d+>/g) ?? [])]

/**
 * A frozen flow may select a third-to-fifth pack card that today's smaller pack never made. Reproduce the mod's
 * selection from an actual current collection, without inventing cards or changing an established identity.
 * Cards referenced elsewhere stay reserved, so two distinct inputs can never become the same consuming input.
 */
export function choosePackCards(o: {
  refs: readonly string[]; omitted: ReadonlyMap<string, Card>; cards: readonly Card[]; team: readonly string[]; now: number
  bound: ReadonlyMap<string, string>; referenced: ReadonlySet<string>; requirement?: MarketWant & { firstFind?: true }; market?: boolean
}): Map<string, string> {
  const reserved = new Set([...o.bound].filter(([key]) => o.referenced.has(key)).map(([, value]) => value))
  const chosen = new Map<string, string>()
  const want = o.requirement ?? {}
  for (const ref of new Set(o.refs)) {
    if (o.bound.has(ref)) continue
    const recorded = o.omitted.get(ref)
    if (!recorded) throw new Unbound(`${ref} was not omitted from a shorter pack`)
    if (recorded.bound || recorded.state !== 'owned' || recorded.lockedUntil > o.now) {
      throw new Unbound(`${ref} was not a free pack card in the recording`)
    }
    const preference = (c: Card) => Number(c.family === recorded.family) * 4 + Number(c.rarity === recorded.rarity) * 2 + Number(c.species === recorded.species)
    const candidates = o.cards.filter(c => !c.bound && c.state === 'owned' && c.lockedUntil <= o.now
      && c.tiredUntil <= o.now && !o.team.includes(c.id) && !reserved.has(c.id)
      && wantMatches(want, c) && (o.market || !want.rarity || c.rarity === want.rarity)
      && (!want.firstFind || c.firstFind))
      .sort((a, b) => preference(b) - preference(a) || a.id.localeCompare(b.id))
    const candidate = candidates[0]
    if (!candidate) throw new Unbound(`${ref} was omitted from a shorter pack, and no observed free card can replace it`)
    chosen.set(ref, candidate.id)
    reserved.add(candidate.id)
  }
  return chosen
}

/** The join's proof of work as the mod solves it (client/remote.ts solvePow): a base-36 counter, leading zero bits. */
function solve(challenge: string, bits: number): string {
  for (let i = 0; i < 1 << 24; i++) if (proofBits(challenge, i.toString(36)) >= bits) return i.toString(36)
  throw new Error('no proof of work found')
}

type Shape =
  | { t: 'null' | 'any' | 'string' | 'number' | 'boolean' }
  | { t: 'array'; item: Shape | null }
  | { t: 'object'; keys: Map<string, Shape>; required: Set<string> }

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/** A recorded value's shape. An array's items merge: a key is required when every recorded item had it. */
function shapeOf(v: unknown): Shape {
  if (Array.isArray(v)) return { t: 'array', item: v.reduce<Shape | null>((s, x) => (s ? merge(s, shapeOf(x)) : shapeOf(x)), null) }
  if (v && typeof v === 'object') {
    const keys = new Map(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]))
    return { t: 'object', keys, required: new Set(keys.keys()) }
  }
  return { t: typeOf(v) as 'string' }
}

function merge(a: Shape, b: Shape): Shape {
  if (a.t === 'null') return b
  if (b.t === 'null') return a
  if (a.t !== b.t) return { t: 'any' }
  if (a.t === 'array' && b.t === 'array') return { t: 'array', item: a.item && b.item ? merge(a.item, b.item) : a.item ?? b.item }
  if (a.t === 'object' && b.t === 'object') {
    const keys = new Map(a.keys)
    for (const [k, s] of b.keys) keys.set(k, keys.has(k) ? merge(keys.get(k)!, s) : s)
    return { t: 'object', keys, required: new Set([...a.required].filter(k => b.required.has(k))) }
  }
  return a
}

/**
 * Every field the recorded answer had, still there with the same JSON type (null either side is the schema's call).
 * `optional` names list-item fields the mod was seen without (optionalItemKeys), which a new item may lack too.
 */
function lost(shape: Shape, v: unknown, path: string, out: Set<string>, optional: (path: string) => boolean): void {
  if (shape.t === 'null' || shape.t === 'any' || v === null) return
  if (typeOf(v) !== shape.t) {
    out.add(`${path} was ${shape.t}, is ${typeOf(v)}`)
    return
  }
  if (shape.t === 'array') {
    if (shape.item) for (const x of v as unknown[]) lost(shape.item, x, `${path}[]`, out, optional)
  } else if (shape.t === 'object') {
    const o = v as Record<string, unknown>
    for (const [k, s] of shape.keys) {
      if (Object.hasOwn(o, k)) lost(s, o[k], `${path}.${k}`, out, optional)
      else if (shape.required.has(k) && !optional(`${path}.${k}`)) out.add(`${path}.${k} is missing`)
    }
  }
}

/**
 * The list-item fields a mod version demonstrably reads as optional: across every answer recorded for it, by
 * operation and path (`me $.notices[].handle`), the keys some item had and another item lacked. One answer's list may
 * hold only items that carry such a key (every notice in it named a player), and a newer kind of item without it
 * is then no break for that mod.
 */
export function optionalItemKeys(flows: readonly Flow[]): Set<string> {
  const seen = new Map<string, { any: Set<string>; every: Set<string> | null }>()
  const walk = (op: string, v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      const at = `${op} ${path}[]`
      for (const x of v) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          const keys = new Set(Object.keys(x))
          const s = seen.get(at) ?? { any: new Set<string>(), every: null }
          for (const k of keys) s.any.add(k)
          s.every = s.every ? new Set([...s.every].filter(k => keys.has(k))) : keys
          seen.set(at, s)
        }
        walk(op, x, `${path}[]`)
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(op, x, `${path}.${k}`)
    }
  }
  for (const f of flows) for (const s of f.steps) if ('op' in s && s.response.status < 300) walk(s.op, s.response.body, '$')
  const out = new Set<string>()
  for (const [at, s] of seen) for (const k of s.any) if (!s.every!.has(k)) out.add(`${at}.${k}`)
  return out
}

const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * Replays a flow against a fresh current server and answers its problems, none when the recorded mod would still
 * work: each answer has the recorded status (and error code), is JSON under the mod's cap, carries Retry-After where
 * it did, reads cleanly with that version's own reader, and keeps every field it had with the same type. A different
 * status, or a placeholder the server never answered, ends the flow there: the steps after it depend on it.
 */
export async function replay(
  flow: Flow, reader: Reader, used: Set<Loosened> = new Set(), loosened: readonly Loosened[] = LOOSENED, optional: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const w = world(flow.flow)
  const bound = new Map<string, string>()
  const omitted = new Map<string, Card>()
  const omittedOwners = new Map<string, string>()
  const referenced = new Set(flow.steps.flatMap(step => 'request' in step ? cardReferences(step.request) : []))
  const teams = new Map<string, string[]>()
  const listings = new Map<string, ListingView>()
  const deals = new Map<string, TraderDealView>()
  const bits = new Map<string, number>()
  const problems: string[] = []
  try {
    for (const [i, step] of flow.steps.entries()) {
      w.begin(i, step.at)
      if ('setup' in step) {
        await w.setup(step)
        continue
      }
      try {
        if ('browser' in step) {
          await w.browser(fill(step, bound))
          continue
        }
        const where = `${flow.flow} step ${i}, ${step.op} (${step.request.method} ${step.request.path})`
        const missing = cardReferences(step.request).filter(ref => omitted.has(ref) && !bound.has(ref))
        if (missing.length) {
          if (!['fuse', 'recycle', 'setForTrade', 'traderDeal', 'buyListing', 'listCard', 'offer'].includes(step.op)
            || missing.some(ref => omittedOwners.get(ref) !== step.player)) {
            throw new Unbound(`${where}: no supported owned-card selection for ${missing.join(', ')}`)
          }
          const path = fill(step.request.path, new Map([...bound, ...missing.map(ref => [ref, ref] as const)]))
          let requirement: MarketWant & { firstFind?: true } = {}
          if (step.op === 'traderDeal') {
            const deal = deals.get(path.split('/')[3]!)
            if (!deal) throw new Unbound(`${where}: the current Trader deal was never observed`)
            requirement = deal.give
          } else if (step.op === 'buyListing') {
            const listing = listings.get(path.split('/')[3]!)
            if (!listing) throw new Unbound(`${where}: the current listing was never observed`)
            requirement = listing.want ?? {}
          }
          // An action that returns the chosen card must retain optional fields the recorded answer showed.
          if (step.op === 'setForTrade' && (step.response.body as { card?: Card }).card?.firstFind) requirement.firstFind = true
          const headers = fill(step.request.headers, bound)
          const cards: Card[] = []
          let next: string | undefined
          const cursors = new Set<string>()
          do {
            const answer = await w.send(step.player, 'GET', '/v1/cards' + (next ? `?after=${encodeURIComponent(next)}` : ''), headers)
            if (answer.status !== 200 || !reader.JSON_CONTENT_TYPE.test(answer.headers['content-type'] ?? '') || bytes(answer.text) > reader.RESPONSE_MAX_BYTES) {
              throw new Unbound(`${where}: the current collection could not be read`)
            }
            const page = reader.parseResponse('cards', JSON.parse(answer.text)) as CardsResponse
            cards.push(...page.cards)
            next = page.next
            if (next && cursors.has(next)) throw new Unbound(`${where}: the collection repeated a page`)
            if (next) cursors.add(next)
          } while (next)
          const team = teams.get(step.player)
          if (!team) throw new Unbound(`${where}: the current team was never observed`)
          const chosen = choosePackCards({ refs: missing, omitted, cards, team, now: w.now(), bound, referenced, requirement, market: step.op === 'buyListing' })
          for (const [ref, id] of chosen) bound.set(ref, id)
        }
        const req = fill(step.request, bound)
        const body = req.body as Record<string, unknown> | undefined
        if (body && body.nonce === '<pow>') body.nonce = solve(String(body.challenge), bits.get(String(body.challenge)) ?? DIFFICULTY)
        const res = await w.send(step.player, req.method, req.path, req.headers, body === undefined ? undefined : JSON.stringify(body))
        const was = step.response
        if (res.status !== was.status) {
          const loose = loosened.find(l =>
            l.client === flow.client && l.flow === flow.flow && l.step === i && l.op === step.op && l.was === was.status && l.now === res.status)
          if (!loose) {
            problems.push(`${where}: answered ${res.status}, was ${was.status}: ${res.text.slice(0, 200)}`)
            break
          }
          used.add(loose)
          try {
            const json = JSON.parse(res.text) as unknown
            if (res.status >= 200 && res.status < 300) reader.parseResponse(step.op, json)
            else reader.parseApiError(json)
          } catch (err) {
            problems.push(`${where}: the ${flow.client} mod cannot read its loosened answer: ${err instanceof Error ? err.message : String(err)}`)
          }
          continue
        }
        if (!reader.JSON_CONTENT_TYPE.test((res.headers['content-type'] ?? '').trim())) problems.push(`${where}: content-type ${res.headers['content-type']} is not JSON`)
        if (bytes(res.text) > reader.RESPONSE_MAX_BYTES) problems.push(`${where}: ${bytes(res.text)} bytes, over the mod's ${reader.RESPONSE_MAX_BYTES}`)
        if (was.headers['retry-after'] !== undefined && !reader.RETRY_AFTER.test(res.headers['retry-after'] ?? '')) problems.push(`${where}: no Retry-After in whole seconds`)
        const json = JSON.parse(res.text) as unknown
        try {
          if (res.status >= 200 && res.status < 300) reader.parseResponse(step.op, json)
          else {
            const code = reader.parseApiError(json).error.code
            const wasCode = (was.body as { error: { code: string } }).error.code
            if (code !== wasCode) problems.push(`${where}: error ${code}, was ${wasCode}`)
          }
        } catch (err) {
          problems.push(`${where}: the ${flow.client} mod cannot read it: ${err instanceof Error ? err.message : String(err)}`)
        }
        const gone = new Set<string>()
        lost(shapeOf(was.body), json, '$', gone, path => optional.has(`${step.op} ${path}`))
        for (const g of gone) problems.push(`${where}: ${g}`)
        if (res.status >= 200 && res.status < 300) {
          const body = json as { player?: { team?: string[] }; team?: string[]; listing?: ListingView; listings?: ListingView[]; deals?: TraderDealView[] }
          if (body.player?.team) teams.set(step.player, body.player.team)
          if (step.op === 'setTeam' && body.team) teams.set(step.player, body.team)
          for (const listing of [...(body.listings ?? []), ...(body.listing ? [body.listing] : [])]) listings.set(listing.id, listing)
          for (const deal of body.deals ?? []) deals.set(deal.id, deal)
          if (step.op === 'openPack') {
            const old = (was.body as OpenPackResponse).cards
            const current = (json as OpenPackResponse).cards
            for (const card of old.slice(current.length)) {
              omitted.set(card.id, card)
              omittedOwners.set(card.id, step.player)
            }
          }
        }
        bindAnswer(was.body, json, bound, new Set(omitted.keys()))
        if (step.op === 'challenge' && res.status === 200) {
          const c = json as { challenge: string; difficulty: number }
          bits.set(c.challenge, c.difficulty)
        }
      } catch (err) {
        if (!(err instanceof Unbound)) throw err
        problems.push(`${flow.flow} step ${i}: ${err.message}`)
        break
      }
    }
  } finally {
    w.close()
  }
  return problems
}

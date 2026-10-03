// The whole game end to end over real HTTP. A Node server is booted in-process (the production app
// on node:http, over a node:sqlite file or over Cloudflare D1, its clock under this script's control
// so days pass in milliseconds), and players are driven by the mod's own RemoteBackend (client/remote.ts and
// client/net.ts): every request is built, checked, sent and read exactly as the mod does it, and
// every answer must also be exactly what the client's reader keeps (no undocumented field, no
// fallback; SPEC 20.9, 32).
//
//   node scripts/e2e.ts                  the two-player run, with the server's own 18-bit proof of work
//   node scripts/e2e.ts --difficulty 12  a faster join
//   node scripts/e2e.ts --keep <file>    keep the database file for a look afterwards
//   node scripts/e2e.ts --d1             the same run over Cloudflare D1 (wrangler's local workerd)
//
// test/e2e/ runs the same code under node --test.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRemoteBackend, joinServer, versionStatus } from '../plugin/hooks/client/remote.ts'
import { BackendError } from '../plugin/hooks/client/types.ts'
import type { Backend, HttpAnswer, HttpInit, Sent } from '../plugin/hooks/client/types.ts'
import type { ApiErrorCode, ApiOp, ApiRequest, ApiResponse, FinishBattleResponse, MeResponse, StartBattleResponse } from '../plugin/hooks/core/api.ts'
import { FEATURES } from '../plugin/hooks/core/api.ts'
import { perfectRounds, RULES_VERSION, simulateBattle } from '../plugin/hooks/core/battle.ts'
import { craftCost, rarityRank, recycleValue } from '../plugin/hooks/core/cards.ts'
import { ECONOMY, finishAfter } from '../plugin/hooks/core/economy.ts'
import { beatenBy, beats, FAMILIES } from '../plugin/hooks/core/families.ts'
import { familySpecies } from '../plugin/hooks/core/species.ts'
import { traderGiveProblem } from '../plugin/hooks/core/trader.ts'
import type { BattleSetup, Card, Family, TraderDeal } from '../plugin/hooks/core/types.ts'
import { dailyRule, fusionCost, seasonOf, utcDay } from '../plugin/hooks/core/world.ts'
import { createApp } from '../server/src/app.ts'
import type { App } from '../server/src/app.ts'
import type { D1Database } from '../server/src/cloudflare.d.ts'
import { d1Db } from '../server/src/db.ts'
import type { Db, SqlValue, Stmt } from '../server/src/db.ts'
import { NOTICE_TEXT } from '../server/src/game/notices.ts'
import { loadMigrations, openDatabase, serve } from '../server/src/node.ts'
import { softAuthenticator } from '../test/server/passkeys-helpers.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** 2026-10-02 12:00 UTC: season 1, day 2. */
export const T0 = Date.UTC(2026, 9, 2, 12)
const SECRET = 'e2e-secret-not-for-production-0123456789'

// ---------- the server ----------

export type Clock = {
  now(): number
  tick(ms: number): void
  /** moves to `at` unless the clock is already past it (time never runs backwards) */
  until(at: number): void
}

export type Storage = 'sqlite' | 'd1'

export type Boot = {
  /** http://localhost:{port}: what the mod is pointed at */
  origin: string
  storage: Storage
  db: Db
  /** the SQLite file the server runs on (null on D1) */
  file: string | null
  clock: Clock
  app: App
  /** what the app logged (route pattern and error name only) */
  errors: string[]
  close(): Promise<void>
}

export type BootOptions = { now?: number; difficulty?: number; minClient?: string; file?: string; storage?: Storage }

/**
 * Cloudflare D1 as the Worker sees it, run locally by wrangler's workerd (in memory), with every
 * migration applied the way wrangler applies them; null when wrangler cannot start here.
 */
export async function localD1(): Promise<{ db: Db; dispose(): Promise<void> } | null> {
  try {
    process.env.WRANGLER_SEND_METRICS = 'false'
    const { getPlatformProxy, unstable_splitSqlQuery } = await import('wrangler')
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: join(ROOT, 'wrangler.jsonc'), persist: false })
    const d1 = proxy.env.DB
    for (const m of loadMigrations()) await d1.batch(unstable_splitSqlQuery(m.sql).map(s => d1.prepare(s)))
    return { db: d1Db(d1), dispose: () => proxy.dispose() }
  } catch {
    return null
  }
}

/**
 * The production app over node:http on a free port, with a clock to move: over a SQLite file of its
 * own (the Node self-hosting path), or over local D1 (the Worker's storage).
 */
export async function bootServer(o: BootOptions = {}): Promise<Boot> {
  const storage = o.storage ?? 'sqlite'
  let db: Db, file: string | null = null, closeDb: () => Promise<void>
  if (storage === 'd1') {
    const d1 = await localD1()
    if (!d1) throw new Error('wrangler could not start local D1')
    db = d1.db
    closeDb = d1.dispose
  } else {
    const dir = o.file ? null : mkdtempSync(join(tmpdir(), 'spinlings-e2e-'))
    file = o.file ?? join(dir!, 'spinlings.db')
    const opened = openDatabase(file)
    db = opened.db
    closeDb = async () => {
      opened.sqlite.close()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  }
  let now = o.now ?? T0
  const clock: Clock = { now: () => now, tick: ms => { now += ms }, until: at => { now = Math.max(now, at) } }
  const errors: string[] = []
  const app = createApp({
    db, now: () => now, log: m => { errors.push(m) },
    config: { secret: SECRET, ...(o.difficulty ? { difficulty: o.difficulty } : {}), ...(o.minClient ? { minClient: o.minClient } : {}) },
  })
  // one reverse proxy in front, so each simulated player can come from an address of its own
  const served = await serve({ app, port: 0, host: '127.0.0.1', trustProxy: 1 })
  return {
    origin: served.origin, storage, db, file, clock, app, errors,
    async close() {
      await served.close()
      await closeDb()
    },
  }
}

// ---------- a player, as the mod ----------

export type Wire = { method: string; url: string; headers: Record<string, string>; body: string | undefined; status: number; answer: Record<string, string>; text: string }

export type Client = {
  readonly name: string
  readonly family: Family
  /** the mod's RemoteBackend for this player */
  readonly api: Backend
  token: string | null
  /** the privacy log the mod keeps (token redacted) */
  readonly sent: Sent[]
  /** every exchange on the wire, raw */
  readonly wire: Wire[]
  /** an operation through the RemoteBackend; the answer must be exactly what the client's reader keeps */
  call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>>
  /** the BackendError an operation fails with (and its code, when given) */
  fails<K extends ApiOp>(op: K, req: ApiRequest<K>, code?: ApiErrorCode): Promise<BackendError>
  /** challenge, proof of work and join, as the mod's first run does it */
  join(): Promise<MeResponse>
  me(): Promise<MeResponse>
}

let addresses = 0

export function connect(boot: Boot, name: string, family: Family, o: { ip?: string } = {}): Client {
  const ip = o.ip ?? `198.51.100.${++addresses}`
  const sent: Sent[] = []
  const wire: Wire[] = []
  let last: Wire | null = null
  let busy = false

  const fetchVia = async (url: string, init: HttpInit): Promise<HttpAnswer> => {
    // the network: one proxy hop, so the server reads this player's own address
    const headers = { ...init.headers, 'x-forwarded-for': ip }
    const res = await fetch(url, { method: init.method, headers, ...(init.body === undefined ? {} : { body: init.body }), redirect: 'manual' })
    const answer: HttpAnswer = { status: res.status, ok: res.ok, headers: {}, text: await res.text() }
    res.headers.forEach((v, k) => { answer.headers[k] = v })
    last = { method: init.method, url, headers: init.headers, body: init.body, status: res.status, answer: answer.headers, text: answer.text }
    wire.push(last)
    return answer
  }

  const client: Client = {
    name, family, sent, wire, token: null,
    api: createRemoteBackend({
      origin: boot.origin,
      fetch: fetchVia,
      token: async () => client.token,
      now: async () => boot.clock.now(),
      after: (ms, fn) => {
        const t = setTimeout(fn, ms)
        t.unref?.()
        return { cancel: () => clearTimeout(t) }
      },
      sent: entry => { sent.push(entry) },
    }),
    async call<K extends ApiOp>(op: K, req: ApiRequest<K>): Promise<ApiResponse<K>> {
      // one request at a time per player, so `last` is this call's answer
      assert.ok(!busy, `${name}: ${op} while another call is in flight`)
      busy = true
      last = null
      try {
        const out = await client.api.call(op, req)
        assert.ok(last, `${name}: ${op} answered without a request`)
        assert.deepEqual(out, JSON.parse((last as Wire).text), `${name}: ${op} answered fields the wire contract does not list`)
        return out as ApiResponse<K>
      } finally {
        busy = false
      }
    },
    async fails(op, req, code) {
      try {
        await client.call(op, req)
      } catch (err) {
        if (!(err instanceof BackendError)) throw err
        if (code) assert.equal(err.code, code, `${name}: ${op} failed with ${err.code} (${err.message}), not ${code}`)
        return err
      }
      return assert.fail(`${name}: ${op} should have failed${code ? ` with ${code}` : ''}`)
    },
    async join() {
      const via = { ...client.api, challenge: (r: ApiRequest<'challenge'>) => client.call('challenge', r), join: (r: ApiRequest<'join'>) => client.call('join', r) } as Backend
      const joined = await joinServer(via, family, () => new Promise(done => setImmediate(done)))
      client.token = joined.token
      return joined.me
    },
    me: () => client.call('me', {}),
  }
  return client
}

// ---------- battles, as the mod plays them ----------

/** The rounds to press 1 on: every round the attacker's special fires, found in order (a press only changes later rounds). */
export function perfectInputs(setup: BattleSetup): number[] {
  const inputs: number[] = []
  for (;;) {
    const next = perfectRounds(simulateBattle(setup, inputs)).find(r => r > (inputs.at(-1) ?? 0))
    if (next === undefined) return inputs
    inputs.push(next)
  }
}

export type Played = { start: StartBattleResponse; fin: FinishBattleResponse; inputs: number[] }

/**
 * One battle: start, simulate locally with the server's setup (the rules match), press on every
 * Perfect round, wait out the minimum duration, finish, and check the server's replay is the
 * client's to the last hit.
 */
export async function battle(
  boot: Boot, c: Client, kind: 'wild' | 'duel', o: { revenge?: string; handle?: string; press?: boolean; early?: boolean } = {},
): Promise<Played> {
  const req = { kind, family: c.family, ...(o.revenge ? { revenge: o.revenge } : {}), ...(o.handle ? { handle: o.handle } : {}) }
  let start: StartBattleResponse | null = null
  for (let tries = 0; !start; tries++) {
    try {
      start = await c.call('startBattle', req)
    } catch (err) {
      // a whole collection resting (every card fainted in the last 15 minutes): wait for the first to wake
      if (!(err instanceof BackendError) || err.code !== 'rate_limited' || tries >= 5) throw err
      boot.clock.tick(Number(c.wire.at(-1)!.answer['retry-after'] ?? 60) * 1000)
    }
  }
  assert.equal(start.setup.rules, RULES_VERSION, 'the server simulates with this mod\'s rules')
  assert.equal(start.setup.kind, kind)
  assert.equal(start.setup.arena, c.family, 'the arena is the family of the model in use')
  assert.equal(start.finishAfter, finishAfter(start.startedAt, simulateBattle(start.setup, []).rounds.length))
  const inputs = o.press === false ? [] : perfectInputs(start.setup)
  const local = simulateBattle(start.setup, inputs)
  if (o.early) {
    // the minimum duration (SPEC 15): finishing at once is refused, and the client simply waits
    await c.fails('finishBattle', { battleId: start.id, inputs }, 'conflict')
  }
  // never sooner than the server's replay of these inputs, which presses can make longer (SPEC 15)
  boot.clock.until(Math.max(start.finishAfter, finishAfter(start.startedAt, local.rounds.length)))
  const fin = await c.call('finishBattle', { battleId: start.id, inputs })
  assert.deepEqual(fin.log, local, 'the server\'s replay is the client\'s simulation')
  assert.equal(fin.result, local.result)
  for (const r of inputs) {
    assert.ok(fin.log.rounds.find(x => x.round === r)!.actions.some(a => a.side === 'a' && a.move === 'special' && a.perfect), `round ${r} is Perfect`)
  }
  return { start, fin, inputs }
}

/** Waits (on the server's clock) until the next battle of this kind is allowed, as the mod reads it from /v1/me. */
export async function whenAllowed(boot: Boot, c: Client, kind: 'wild' | 'duel'): Promise<void> {
  const p = (await c.me()).player
  boot.clock.until(kind === 'wild' ? p.nextWildAt : p.nextDuelAt)
}

// ---------- database checks ----------

/** Every cell anywhere in the database holding one of these values (exactly, or inside JSON text). */
export async function residue(db: Db, needles: readonly string[], skip: (table: string, column: string) => boolean = () => false): Promise<string[]> {
  const tables = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
  const hits: string[] = []
  for (const { name } of tables) {
    for (const row of await db.all<Record<string, unknown>>(`SELECT * FROM "${name}"`)) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v !== 'string' || skip(name, col)) continue
        for (const n of needles) if (v === n || v.includes(n)) hits.push(`${name}.${col}`)
      }
    }
  }
  return [...new Set(hits)].sort()
}

/**
 * The admin's drop tool (scripts/admin/drop.ts) against the running server's database: the command
 * line itself on a SQLite file (`--local --db`), its create path in-process on D1 (the CLI would
 * reach local D1 only through a persisted wrangler state).
 */
export async function adminDrop(boot: Boot, args: string[]): Promise<void> {
  if (boot.file) {
    const cli = [join(ROOT, 'scripts/admin/drop.ts'), args[0]!, '--local', '--db', boot.file, ...args.slice(1)]
    await new Promise<void>((done, reject) => {
      execFile(process.execPath, ['--disable-warning=ExperimentalWarning', ...cli], { cwd: ROOT, timeout: 60_000 }, (err, _out, stderr) =>
        (err ? reject(new Error(`drop.ts: ${stderr || err.message}`)) : done()))
    })
    return
  }
  const { createDrop, createOptions, parseArgs } = await import('./admin/drop.ts')
  const parsed = parseArgs(args)
  const io = { now: Date.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)), out: () => {}, err: () => {} }
  const target = { name: 'local D1', run: async (stmts: readonly Stmt[]) => { await boot.db.batch([...stmts]) }, all: <T>(sql: string, ...p: SqlValue[]) => boot.db.all<T>(sql, ...p) }
  const preview = parsed.flags.get('preview')
  await createDrop(await createOptions(parsed.flags, io), target, io, { yes: true, ...(typeof preview === 'string' ? { previewFile: preview } : {}) })
}

// ---------- the run ----------

export type Step = { name: string; ms: number; note: string }
export type RunOptions = { difficulty?: number; file?: string; storage?: Storage; log?: (line: string) => void }
export type Report = { steps: Step[]; ms: number; requests: number; /** foil cards seen */ foil: number }

const free = (c: Card, now: number, team: readonly string[]) => !c.bound && c.state === 'owned' && c.lockedUntil <= now && !team.includes(c.id) && c.species !== 'mythic'

export async function runE2E(o: RunOptions = {}): Promise<Report> {
  const log = o.log ?? (() => {})
  const boot = await bootServer({ ...(o.difficulty ? { difficulty: o.difficulty } : {}), ...(o.file ? { file: o.file } : {}), ...(o.storage ? { storage: o.storage } : {}) })
  const { clock } = boot
  const steps: Step[] = []
  const began = performance.now()
  const step = async (name: string, run: () => Promise<string | void>) => {
    const t = performance.now()
    let note: string | void
    try {
      note = await run()
    } catch (err) {
      log(`FAIL ${name}`)
      if (err instanceof Error) err.message = `${name}: ${err.message}`
      throw err
    }
    const s = { name, ms: Math.round(performance.now() - t), note: note ?? '' }
    steps.push(s)
    log(`ok   ${name} (${s.ms} ms)${s.note ? ' · ' + s.note : ''}`)
  }

  const p1 = connect(boot, 'p1', 'opus')
  const p2 = connect(boot, 'p2', 'haiku')
  const p3 = connect(boot, 'p3', 'fable')
  const cardsOf = async (c: Client) => (await c.call('cards', {})).cards
  const sparksOf = async (c: Client) => (await c.me()).player.sparks
  let firstHandle = ''
  let foilCards = 0

  try {
    await step('version handshake', async () => {
      const v = await p1.call('version', {})
      const status = versionStatus(v)
      assert.deepEqual([status.readOnly, status.rulesMatch, status.generatorMatch], [false, true, true])
      assert.deepEqual([...v.features].sort(), [...FEATURES].sort())
      const world = await p1.call('world', {})
      assert.equal(world.season, seasonOf(clock.now()))
      const season = await p1.call('season', { season: world.season })
      assert.equal(season.species.length, 36)
      return `rules ${v.rules}, generator ${v.generator}, ${v.features.length} features, today ${world.rule}`
    })

    // ---- player 1, alone in the world ----

    let me1!: MeResponse
    await step('join with proof of work', async () => {
      const t = performance.now()
      me1 = await p1.join()
      const pow = Math.round(performance.now() - t)
      const body = JSON.parse(p1.sent.find(s => s.path === '/v1/join')!.body) as Record<string, unknown>
      assert.deepEqual(Object.keys(body).sort(), ['challenge', 'family', 'nonce'], 'the join sends nothing but the proof and the family')
      assert.match(me1.player.handle, /^[a-z]+-[a-z]+-\d{2,4}$/)
      assert.equal(me1.player.sparks, ECONOMY.sparks.start)
      assert.equal(me1.packs.length, ECONOMY.packs.welcome)
      assert.ok(me1.packs.every(p => p.source === 'welcome'))
      assert.ok(me1.packs.some(p => p.family === 'opus'))
      const starters = await cardsOf(p1)
      assert.equal(starters.length, 3)
      assert.deepEqual([...me1.player.team].sort(), starters.map(c => c.id).sort(), 'the starters are the team')
      // a family of the server's choosing, the one it beats and the one that beats it: never a tell of the model in use
      const families = new Set(starters.map(c => c.family))
      assert.ok(FAMILIES.some(f => [f, beats(f), beatenBy(f)].every(x => families.has(x))), 'three neighbours in the type cycle')
      assert.equal(me1.player.nextChargeAt, clock.now() + ECONOMY.packs.chargeSpacingMs, 'the first pack charges like any other')
      for (const c of starters) {
        assert.deepEqual([c.bound, c.origin, c.level, c.xp, c.stage], [true, 'starter', ECONOMY.starter.level, ECONOMY.starter.xp, 1])
      }
      assert.ok(starters.every(c => c.firstFind), 'the first player in the world finds every species first')
      const challenge = p1.wire.find(w => w.url.endsWith('/v1/challenge'))!
      firstHandle = me1.player.handle
      return `${me1.player.handle}, ${JSON.parse(challenge.text).difficulty}-bit proof in ${pow} ms`
    })

    await step('open the welcome packs (firsts, foil)', async () => {
      const before = new Set((await cardsOf(p1)).map(c => c.species))
      const opened: Card[] = []
      for (const pack of me1.packs) {
        const { cards } = await p1.call('openPack', { packId: pack.id })
        assert.equal(cards.length, ECONOMY.packs.size)
        opened.push(...cards)
      }
      await p1.fails('openPack', { packId: me1.packs[0]!.id }, 'not_found')
      for (const c of opened) {
        assert.equal(c.origin, 'pack')
        assert.equal(c.lockedUntil, 0, 'welcome-pack cards trade at once (SPEC 8)')
        assert.equal(c.firstFind === true, !before.has(c.species), `${c.species}: firstFind exactly on the first of its species`)
        before.add(c.species)
        if (c.rarity === 'legendary') assert.equal(c.foil, true, 'every legendary is foil')
      }
      foilCards += opened.filter(c => c.foil).length
      assert.equal((await p1.me()).packs.length, 0)
      const firsts = opened.filter(c => c.firstFind).length
      return `${opened.length} cards, ${firsts} first discoveries, ${opened.filter(c => c.foil).length} foil, rarest ${opened.map(c => c.rarity).sort((a, b) => rarityRank(b) - rarityRank(a))[0]}`
    })

    await step('set the team', async () => {
      const cards = await cardsOf(p1)
      const starters = cards.filter(c => c.origin === 'starter')
      const best = cards.filter(c => c.origin !== 'starter').sort((a, b) => b.stats.atk + b.stats.hp - (a.stats.atk + a.stats.hp))[0]!
      const team = [starters[0]!.id, starters[1]!.id, best.id]
      assert.deepEqual((await p1.call('setTeam', { cardIds: team })).team, team)
      assert.deepEqual((await p1.me()).player.team, team)
      await p1.fails('setTeam', { cardIds: ['nosuchcardanywhere0000000a'] }, 'not_found')
      // back to the three starters: the first win evolves them
      const starterTeam = starters.map(c => c.id)
      await p1.call('setTeam', { cardIds: starterTeam })
      return `${team.length} slots`
    })

    const grownIds = new Set<string>()
    await step('wild battle with a Perfect press and a catch', async () => {
      let perfect = 0, caught: Card | null = null, battles = 0
      for (; battles < 24 && !(perfect && caught && grownIds.size); battles++) {
        await whenAllowed(boot, p1, 'wild')
        const { start, fin, inputs } = await battle(boot, p1, 'wild', { early: battles === 0 })
        assert.deepEqual(start.opponent, { kind: 'wild' })
        if (battles === 0) await p1.fails('startBattle', { kind: 'wild', family: 'opus' }, 'rate_limited')
        perfect += inputs.length
        for (const x of fin.xp) if (x.evolved) grownIds.add(x.cardId)
        if (fin.result === 'win' && fin.catchOptions.length && !caught) {
          assert.deepEqual(fin.catchOptions, start.setup.defender.filter((_, i) => fin.log.fainted.d.includes(i)), 'only the creatures it defeated')
          const pick = fin.catchOptions.reduce((best, c, i) => (rarityRank(c.rarity) > rarityRank(fin.catchOptions[best]!.rarity) ? i : best), 0)
          caught = (await p1.call('catchCreature', { battleId: start.id, index: pick })).card
          assert.equal(caught.origin, 'catch')
          assert.equal(caught.species, fin.catchOptions[pick]!.species)
          await p1.fails('catchCreature', { battleId: start.id, index: pick }, 'conflict')
        }
      }
      assert.ok(perfect > 0, 'a Perfect special landed')
      assert.ok(caught, 'a wild win caught a creature')
      return `${battles} wild battles, ${perfect} Perfect presses, caught ${caught!.rarity} ${caught!.species}`
    })

    await step('evolution and raised forms', async () => {
      assert.ok(grownIds.size > 0, 'a won battle evolved a creature (starters sit 20 xp short of level 4)')
      const grown = (await cardsOf(p1)).filter(c => grownIds.has(c.id))
      for (const c of grown) {
        assert.equal(c.stage, 2)
        assert.ok(c.level >= ECONOMY.levels.evolveAt[0])
        assert.equal(c.raisedIn, 'opus', 'raised in the arena it battled in')
      }
      return `${grown.length} at stage 2 (${grown.map(c => c.origin).join(', ')}), raised under opus`
    })

    await step('Rival duel when alone', async () => {
      await whenAllowed(boot, p1, 'duel')
      const before = (await p1.me()).player.rating
      const { start, fin } = await battle(boot, p1, 'duel')
      assert.equal(start.opponent.kind, 'rival')
      assert.deepEqual(Object.keys(start.opponent).sort(), ['kind', 'league', 'name'])
      assert.equal(fin.rating, before + fin.ratingDelta)
      assert.equal((await p1.me()).player.rating, fin.rating)
      return `vs Rival ${(start.opponent as { name: string }).name}: ${fin.result}, rating ${fin.ratingDelta >= 0 ? '+' : ''}${fin.ratingDelta}`
    })

    // ---- player 2 arrives ----

    await step('a second player joins', async () => {
      const found = new Set((await cardsOf(p1)).map(c => c.species))
      const me2 = await p2.join()
      assert.notEqual(me2.player.handle, firstHandle)
      for (const pack of me2.packs) await p2.call('openPack', { packId: pack.id })
      const cards = await cardsOf(p2)
      for (const c of cards) if (found.has(c.species)) assert.ok(!c.firstFind, `${c.species} was found first by player 1`)
      return `${me2.player.handle}, ${cards.length} cards, ${cards.filter(c => c.firstFind).length} still-unfound species`
    })

    await step('duel vs player 2, a coarse defense notice and revenge', async () => {
      const handles = { p1: (await p1.me()).player.handle, p2: (await p2.me()).player.handle }
      const pairs: [Client, Client, string][] = [[p1, p2, handles.p2], [p2, p1, handles.p1]]
      let revenged = ''
      const met: string[] = []
      // the same two players meet again only once 5 other opponents (Rivals) have come between
      for (let round = 0; round < 30 && !revenged; round++) {
        for (const [att, def, defHandle] of pairs) {
          // a rested team, as a player who duels now and then has: every card that fainted is awake again
          boot.clock.tick(ECONOMY.battle.tiredMs)
          await whenAllowed(boot, att, 'duel')
          const { start, fin } = await battle(boot, att, 'duel')
          if (start.opponent.kind !== 'player') continue // recently met: a Rival filled in
          met.push(`${att.name}:${fin.result}`)
          assert.deepEqual(start.opponent, { kind: 'player', handle: defHandle, league: start.opponent.league }, 'the opponent shows a handle and a league, never a rating')
          const attHandle = defHandle === handles.p2 ? handles.p1 : handles.p2
          const notices = (await def.me()).notices.filter(n => n.handle === attHandle && n.kind.startsWith('defense-'))
          if (fin.result === 'draw') continue
          const n = notices.find(x => x.kind === (fin.result === 'win' ? 'defense-loss' : 'defense-win'))
          assert.ok(n, `${def.name} got a ${fin.result === 'win' ? 'defense-loss' : 'defense-win'} notice`)
          assert.equal(n.day, utcDay(clock.now()), 'the notice carries the day only')
          assert.deepEqual(Object.keys(n).sort(), ['day', 'handle', 'id', 'kind', 'text'])
          assert.ok(!n.text.includes(attHandle), 'the text names nobody')
          if (fin.result !== 'win') continue
          // the defender takes its revenge: a duel against that player's current team, once
          await whenAllowed(boot, def, 'duel')
          const r = await battle(boot, def, 'duel', { revenge: attHandle })
          const foe = r.start.opponent
          assert.ok(foe.kind === 'player' && foe.handle === attHandle, 'a revenge is a duel against that very player')
          const won = r.fin.result === 'win'
          assert.equal(r.fin.sparks, won ? ECONOMY.battle.sparks.duelWin + ECONOMY.battle.revengeBonus : r.fin.result === 'draw' ? ECONOMY.battle.sparks.draw : ECONOMY.battle.sparks.loss)
          boot.clock.tick(ECONOMY.battle.tiredMs)
          await whenAllowed(boot, def, 'duel')
          await def.fails('startBattle', { kind: 'duel', family: def.family, revenge: attHandle }, 'not_found')
          revenged = `${met.length} duels between them (${met.join(' ')}), then ${def.name} took revenge on ${att.name}: ${r.fin.result}, ${r.fin.sparks} sparks`
          break
        }
      }
      assert.ok(revenged, 'some duel ended in a defense loss and a revenge')
      return revenged
    })

    // ---- days pass: presence packs and plenty of battles ----

    await step('days of play, charging packs on the way', async () => {
      let charged = 0
      const PLAYED = 10
      const cleared = async (c: Client) => (await c.me()).player.battles >= PLAYED
      for (const c of [p1, p2]) assert.equal((await c.me()).player.canTrade, true, 'no account limits on trading (SPEC 8)')
      for (let i = 0; i < 40 && !((await cleared(p1)) && (await cleared(p2))); i++) {
        for (const c of [p1, p2]) {
          const p = (await c.me()).player
          if (p.battles >= PLAYED) continue
          if (clock.now() >= p.nextChargeAt) {
            await c.call('chargePack', { family: c.family })
            charged++
          }
          const kind = clock.now() >= p.nextWildAt ? 'wild' : 'duel'
          await whenAllowed(boot, c, kind)
          await battle(boot, c, kind)
        }
        clock.tick(2 * MINUTE)
      }
      clock.tick(45 * MINUTE)
      for (const c of [p1, p2]) {
        await c.call('chargePack', { family: c.family })
        await c.fails('chargePack', { family: c.family }, 'rate_limited')
        charged++
      }
      // three calendar days on from the join day
      clock.until(Date.UTC(2026, 9, 5, 9))
      for (const c of [p1, p2]) for (const pack of (await c.me()).packs) await c.call('openPack', { packId: pack.id })
      const [b1, b2] = [(await p1.me()).player.battles, (await p2.me()).player.battles]
      return `${b1} and ${b2} battles, ${charged} packs charged, now ${utcDay(clock.now())}`
    })

    await step('fusion', async () => {
      const team = (await p1.me()).player.team
      const pool = (await cardsOf(p1)).filter(c => !c.bound && c.state === 'owned' && !team.includes(c.id) && c.species !== 'mythic')
      const [a, b] = pool.sort((x, y) => recycleValue(x) - recycleValue(y))
      assert.ok(a && b, 'two free cards to fuse')
      const before = await sparksOf(p1)
      const cost = fusionCost(dailyRule(clock.now()))
      const { card, consumed } = await p1.call('fuse', { cardId: a.id, otherId: b.id })
      assert.deepEqual(consumed, [a.id, b.id])
      assert.equal(card.species, 'fusion')
      assert.equal(card.form?.kind, 'fusion')
      assert.deepEqual(card.form?.parents, [a.species, b.species])
      assert.equal(card.family, b.family, 'the hybrid takes parent B\'s family')
      assert.equal(card.origin, 'fusion')
      assert.equal(await sparksOf(p1), before - cost)
      const ids = new Set((await cardsOf(p1)).map(c => c.id))
      assert.ok(!ids.has(a.id) && !ids.has(b.id) && ids.has(card.id))
      await p1.fails('fuse', { cardId: a.id, otherId: card.id }, 'not_found')
      return `${card.form!.names[card.stage - 1]} (${card.rarity}) for ${cost} sparks`
    })

    await step('recycle', async () => {
      const team = (await p1.me()).player.team
      const c = (await cardsOf(p1)).filter(x => !x.bound && x.state === 'owned' && !team.includes(x.id)).sort((x, y) => recycleValue(x) - recycleValue(y))[0]!
      const before = await sparksOf(p1)
      const r = await p1.call('recycle', { cardId: c.id })
      assert.equal(r.gained, recycleValue(c))
      assert.equal(r.sparks, before + r.gained)
      await p1.fails('recycle', { cardId: c.id }, 'not_found')
      const bound = (await cardsOf(p1)).find(x => x.bound)!
      await p1.fails('recycle', { cardId: bound.id }, 'not_allowed')
      return `${c.rarity} for ${r.gained} sparks`
    })

    await step('craft', async () => {
      const species = familySpecies(seasonOf(clock.now()), 'sonnet').find(s => !s.legendary)!
      const before = await sparksOf(p1)
      const { card } = await p1.call('craft', { speciesId: species.id, rarity: 'common' })
      assert.deepEqual([card.species, card.rarity, card.origin, card.lockedUntil], [species.id, 'common', 'craft', 0])
      assert.equal(await sparksOf(p1), before - craftCost('common'))
      await p1.fails('craft', { speciesId: `s${seasonOf(clock.now()) + 1}-sonnet-0`, rarity: 'common' }, 'not_allowed')
      return `${species.names[0]} for ${craftCost('common')} sparks`
    })

    await step('a Trader deal', async () => {
      let done = ''
      for (let day = 0; day < 8 && !done; day++, clock.tick(DAY)) {
        const { deals } = await p1.call('trader', {})
        assert.equal(deals.length, ECONOMY.trader.deals)
        const team = (await p1.me()).player.team
        const pool = (await cardsOf(p1)).filter(c => free(c, clock.now(), team)).sort((a, b) => recycleValue(a) - recycleValue(b))
        for (const deal of deals) {
          const give = pickFor(deal, pool)
          if (!give || traderGiveProblem(deal, give, clock.now())) continue
          const got = await p1.call('traderDeal', { dealId: deal.id, cardIds: give.map(c => c.id) })
          assert.deepEqual(got.consumed, give.map(c => c.id))
          if (deal.get.kind === 'pack') assert.equal(got.packs.length, deal.get.count)
          else {
            assert.equal(got.cards.length, deal.get.count)
            for (const c of got.cards) assert.deepEqual([c.rarity, c.family, c.origin], [deal.get.rarity, deal.get.family, 'trader'])
          }
          const ids = new Set((await cardsOf(p1)).map(c => c.id))
          assert.ok(give.every(c => !ids.has(c.id)), 'the Trader keeps what it was given')
          assert.equal((await p1.call('trader', {})).deals.find(d => d.id === deal.id)!.used, true)
          await p1.fails('traderDeal', { dealId: deal.id, cardIds: give.map(c => c.id) }, 'conflict')
          done = `"${deal.name}" on ${utcDay(clock.now())}: ${give.length} cards for ${deal.get.count} ${deal.get.kind === 'pack' ? 'pack' : `${deal.get.rarity} card`}${deal.get.count > 1 ? 's' : ''}`
          break
        }
      }
      assert.ok(done, 'one of the Trader\'s deals could be paid within a week')
      return done
    })

    // ---- the market ----

    let theirs!: Card, mine!: Card
    await step('wishlist, for-trade and the board', async () => {
      const now = clock.now()
      const t1 = (await p1.me()).player.team
      const t2 = (await p2.me()).player.team
      const c1 = (await cardsOf(p1)).filter(c => free(c, now, t1))
      const c2 = (await cardsOf(p2)).filter(c => free(c, now, t2) && c.species.startsWith('s') && !c1.some(x => x.species === c.species))
      theirs = c2[0]!
      mine = c1.find(c => c.species.startsWith('s') && c.species !== theirs.species)!
      assert.ok(theirs && mine, 'both players hold a tradeable season card')
      await p2.call('setForTrade', { cardId: theirs.id, forTrade: true })
      await p1.call('setForTrade', { cardId: mine.id, forTrade: true })
      assert.deepEqual((await p1.call('setWishlist', { species: [theirs.species] })).wishlist, [theirs.species])
      await p2.call('setWishlist', { species: [mine.species] })
      assert.deepEqual((await p1.me()).player.wishlist, [theirs.species])
      const board = await p1.call('board', {})
      const p2Handle = (await p2.me()).player.handle
      const match = board.matches.find(m => m.handle === p2Handle)
      assert.ok(match, 'the board matches the two wishlists')
      assert.equal(match.theirs.id, theirs.id)
      assert.equal(match.mine.id, mine.id)
      assert.equal(board.trader.length, ECONOMY.trader.deals)
      const profile = await p1.call('profile', { handle: p2Handle })
      assert.deepEqual(Object.keys(profile).sort(), ['forTrade', 'handle', 'league', 'seenCount', 'stats', 'team'])
      assert.equal(profile.stats!.speciesCollected, profile.seenCount, 'stats are public game numbers')
      assert.ok(profile.forTrade.some(c => c.id === theirs.id))
      for (const c of [...profile.forTrade, ...profile.team]) {
        for (const k of ['mintedAt', 'lockedUntil', 'tiredUntil', 'origin', 'state', 'bound', 'forTrade']) assert.ok(!(k in c), `a public card carries no ${k}`)
      }
      return `${board.matches.length} match, profile shows ${profile.forTrade.length} for trade`
    })

    await step('an offer, accepted, with no fee', async () => {
      const [s1, s2] = [await sparksOf(p1), await sparksOf(p2)]
      const p2Handle = (await p2.me()).player.handle
      const { offer } = await p1.call('offer', { to: p2Handle, give: [mine.id], get: [theirs.id] })
      assert.equal(offer.state, 'open')
      assert.equal(offer.give[0]!.id, mine.id)
      assert.equal((await cardsOf(p1)).find(c => c.id === mine.id)!.state, 'escrow', 'offered cards wait in escrow')
      await p1.fails('recycle', { cardId: mine.id }, 'not_allowed')
      const incoming = (await p2.me()).offers.incoming
      assert.ok(incoming.some(x => x.id === offer.id))
      await p1.fails('acceptOffer', { offerId: offer.id }, 'not_found')
      const accepted = (await p2.call('acceptOffer', { offerId: offer.id })).offer
      assert.equal(accepted.state, 'accepted')
      await p2.fails('acceptOffer', { offerId: offer.id }, 'conflict')
      assert.deepEqual([await sparksOf(p1), await sparksOf(p2)], [s1, s2], 'no fee on either side')
      const got1 = (await cardsOf(p1)).find(c => c.id === theirs.id)!
      const got2 = (await cardsOf(p2)).find(c => c.id === mine.id)!
      assert.ok(got1 && got2, 'the cards swapped owners')
      for (const c of [got1, got2]) {
        assert.deepEqual([c.lockedUntil, c.forTrade, c.state], [0, false, 'owned'], 'free to trade on at once')
      }
      assert.ok((await p1.me()).notices.some(n => n.kind === 'offer-accepted'))
      return `swapped ${mine.species} for ${theirs.species}, no sparks`
    })

    let giftCard!: Card
    await step('a gift, claimed by a newcomer, and the bonus pack', async () => {
      const team = (await p1.me()).player.team
      giftCard = (await cardsOf(p1)).filter(c => free(c, clock.now(), team))[0]!
      const { gift } = await p1.call('gift', { cardId: giftCard.id })
      assert.match(gift.code, /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/)
      assert.ok((await p1.me()).gifts.some(g => g.code === gift.code))
      clock.tick(MINUTE)
      // the invite loop: someone joins after the gift was made and claims it
      await p3.join()
      await p3.fails('claim', { code: 'quiet-otter-lamp-0000' }, 'not_found')
      const { card } = await p3.call('claim', { code: gift.code })
      assert.equal(card.id, giftCard.id)
      assert.equal(card.lockedUntil, 0)
      await p1.fails('claim', { code: gift.code }, 'not_found')
      assert.ok((await p1.me()).notices.some(n => n.kind === 'gift-claimed'))
      // the claimant really plays: 5 battles on 2 different days
      const bonusBefore = (await p1.me()).packs.filter(p => p.source === 'bonus').length
      for (let i = 0; (await p3.me()).player.battles < ECONOMY.gift.bonusBattles; i++) {
        if (i === 2) clock.until(Date.parse(utcDay(clock.now() + DAY) + 'T09:00:00Z'))
        await whenAllowed(boot, p3, 'wild')
        await battle(boot, p3, 'wild')
      }
      assert.equal((await p1.me()).packs.filter(p => p.source === 'bonus').length, bonusBefore, 'nothing the moment the claimant plays')
      // the pack comes with the first sweep of the next day, so the giver never learns when they played
      clock.until(Date.parse(utcDay(clock.now() + DAY) + 'T00:17:00Z'))
      await boot.app.sweep(clock.now())
      const me = await p1.me()
      assert.equal(me.packs.filter(p => p.source === 'bonus').length, bonusBefore + 1, 'the giver got its bonus pack')
      assert.ok(me.notices.some(n => n.kind === 'bonus-pack' && n.handle === undefined), 'naming nobody')
      return `${gift.code} claimed by ${(await p3.me()).player.handle}; bonus pack paid`
    })

    await step('a drop code hatches a foil promo egg', async () => {
      const code = 'MEADOWTEST'
      const args = [
        'create', '--code', code, '--egg', 'Glimmerkin', '--family', 'fable', '--rarity', 'rare', '--foil', '--stamp', 'Meadow test',
        '--packs', '1', '--starts', new Date(T0).toISOString(), '--ends', new Date(Math.max(clock.now(), Date.now()) + 60 * DAY).toISOString(),
        '--preview', join(tmpdir(), `spinlings-e2e-${process.pid}.png`), '--yes',
      ]
      await adminDrop(boot, args)
      const got = await p1.call('redeem', { code: code.toLowerCase() })
      assert.equal(got.cards.length, 1)
      const egg = got.cards[0]!
      assert.deepEqual([egg.species, egg.form?.kind, egg.form?.stamp, egg.foil, egg.origin, egg.bound], ['promo', 'promo', 'Meadow test', true, 'promo', true])
      assert.deepEqual(got.packs.map(p => p.source), ['promo'])
      await p1.fails('redeem', { code }, 'conflict')
      foilCards++
      return `${egg.form!.names[0]}, ${egg.rarity} foil, plus ${got.packs.length} pack`
    })

    await step('the market: sold for sparks while away, a swap, a race, a cancel and recent prices', async () => {
      const h1 = (await p1.me()).player.handle
      const pool1 = async () => {
        const team = (await p1.me()).player.team
        return (await cardsOf(p1)).filter(c => free(c, clock.now(), team) && c.species.startsWith('s'))
      }
      const [forSparks, forSwap, forRace, kept] = await pool1()
      assert.ok(forSparks && forSwap && forRace && kept, 'four season cards to sell')
      const sold = (await p1.call('listCard', { cardId: forSparks.id, price: 30 })).listing
      assert.deepEqual([sold.seller, sold.price, sold.state, sold.day, sold.want], [h1, 30, 'open', utcDay(clock.now()), undefined])
      assert.equal((await cardsOf(p1)).find(c => c.id === forSparks.id)!.state, 'escrow', 'a listed card waits in escrow')
      await p1.fails('recycle', { cardId: forSparks.id }, 'not_allowed')
      await p1.fails('listCard', { cardId: forSparks.id, price: 40 }, 'not_allowed')
      assert.deepEqual((await p1.me()).listings!.map(l => l.id), [sold.id], 'my open listings')
      // the seller is away: a day passes, and the buyer finds it on the market
      clock.tick(DAY)
      const page = await p2.call('market', { sort: 'cheapest', maxPrice: 30 })
      assert.ok(page.listings.some(l => l.id === sold.id))
      for (const k of ['mintedAt', 'lockedUntil', 'origin', 'state', 'bound']) assert.ok(!(k in page.listings[0]!.card), `a listed card shows no ${k}`)
      await p1.fails('buyListing', { listingId: sold.id }, 'not_allowed')
      const [s1, s2] = [await sparksOf(p1), await sparksOf(p2)]
      const bought = await p2.call('buyListing', { listingId: sold.id })
      assert.deepEqual([bought.card.id, bought.card.state, bought.listing.state, bought.sparks], [forSparks.id, 'owned', 'sold', s2 - 30])
      assert.deepEqual([await sparksOf(p1), await sparksOf(p2)], [s1 + 30, s2 - 30], 'every spark to the seller: no fee')
      await p2.fails('buyListing', { listingId: sold.id }, 'conflict')
      const news = (await p1.me()).notices.find(n => n.kind === 'market-sold')!
      assert.deepEqual([news.day, news.handle], [utcDay(clock.now()), (await p2.me()).player.handle])
      // a swap: p2's card that fits what p1 wants
      const t2 = (await p2.me()).player.team
      const offerCard = (await cardsOf(p2)).find(c => free(c, clock.now(), t2) && c.id !== forSparks.id)!
      const swap = (await p1.call('listCard', { cardId: forSwap.id, want: { family: offerCard.family, rarity: offerCard.rarity } })).listing
      await p2.fails('buyListing', { listingId: swap.id }, 'bad_request')
      const done = await p2.call('buyListing', { listingId: swap.id, cardId: offerCard.id })
      assert.equal(done.card.id, forSwap.id)
      assert.ok((await cardsOf(p1)).some(c => c.id === offerCard.id), 'the wanted card went to the seller')
      // two buyers at once: exactly one wins, the other hears it is already sold
      const race = (await p1.call('listCard', { cardId: forRace.id, price: 5 })).listing
      const out = await Promise.allSettled([p2.call('buyListing', { listingId: race.id }), p3.call('buyListing', { listingId: race.id })])
      const lost = out.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason as BackendError)
      assert.deepEqual(lost.map(e => [e.code, e.message]), [['conflict', 'Already sold']])
      // a sale counts, and keeps its price, once per buyer: p2 bought twice already
      const newBuyer = out[1]!.status === 'fulfilled'
      // the seller takes one back, and the prices of what sold show next to the next listing of that species
      const back = (await p1.call('listCard', { cardId: kept.id, price: 9 })).listing
      await p3.fails('cancelListing', { listingId: back.id }, 'not_found')
      assert.equal((await p1.call('cancelListing', { listingId: back.id })).listing.state, 'cancelled')
      assert.equal((await cardsOf(p1)).find(c => c.id === kept.id)!.state, 'owned')
      const resold = (await p2.call('listCard', { cardId: forSparks.id, price: 35 })).listing
      const prices = (await p3.call('market', { species: forSparks.species })).prices.find(p => p.species === forSparks.species)!
      assert.deepEqual(prices.sales.map(s => s.price), forRace.species === forSparks.species && newBuyer ? [5, 30] : [30],
        'the sales for sparks, newest first, with no names')
      assert.equal((await p2.call('cancelListing', { listingId: resold.id })).listing.state, 'cancelled')
      assert.equal((await p1.me()).player.stats!.marketSales, newBuyer ? 2 : 1, 'sales to different buyers')
      return `sold for 30 sparks to ${news.handle}, swapped for a ${offerCard.rarity} ${offerCard.family} card, one of two racing buyers won`
    })

    await step('a challenge by handle, with the defense notice', async () => {
      const h1 = (await p1.me()).player.handle
      boot.clock.tick(ECONOMY.battle.tiredMs)
      await whenAllowed(boot, p2, 'duel')
      await p2.fails('startBattle', { kind: 'duel', family: p2.family, handle: (await p2.me()).player.handle }, 'not_allowed')
      await whenAllowed(boot, p2, 'duel')
      const { start, fin } = await battle(boot, p2, 'duel', { handle: h1 })
      assert.ok(start.opponent.kind === 'player' && start.opponent.handle === h1, 'the challenged player, not a random one')
      const kind = fin.result === 'win' ? 'defense-loss' : fin.result === 'loss' ? 'defense-win' : null
      const h2 = (await p2.me()).player.handle
      if (kind) assert.ok((await p1.me()).notices.some(n => n.kind === kind && n.handle === h2), `${h1} got a ${kind} notice naming ${h2}`)
      await p2.fails('startBattle', { kind: 'duel', family: p2.family, handle: h1 }, 'rate_limited')
      return `${p2.name} challenged ${h1}: ${fin.result}`
    })

    await step('leaderboards and stats', async () => {
      // others see the numbers as they stood at the last midnight: the next one, and they are today's
      clock.tick(DAY - (clock.now() % DAY))
      const h1 = (await p1.me()).player.handle
      const me = await p1.me()
      assert.equal(me.player.leaderboard, true, 'on the boards by default')
      assert.ok((await p2.call('leaderboard', {})).top.some(r => r.handle === h1 && r.rating === me.player.rating))
      const rating = await p2.call('rankings', {})
      assert.deepEqual([rating.board, rating.period], ['rating', 'all'])
      assert.ok(rating.top.some(r => r.handle === h1))
      const sales = await p1.call('rankings', { board: 'sales', period: 'season' })
      assert.deepEqual([sales.top[0]!.handle, sales.top[0]!.value, sales.me!.rank], [h1, me.player.stats!.marketSales, 1])
      const species = await p3.call('rankings', { board: 'species' })
      assert.ok(species.me && species.me.value === (await p3.me()).player.seen.length)
      assert.deepEqual(await p1.call('setLeaderboard', { optIn: false }), { leaderboard: false })
      assert.ok(!(await p2.call('rankings', { board: 'sales' })).top.some(r => r.handle === h1), 'hidden from every board')
      assert.equal((await p1.call('rankings', { board: 'sales' })).me, undefined)
      assert.equal((await p2.call('profile', { handle: h1 })).stats, undefined, 'and no stats on the profile')
      await p1.call('setLeaderboard', { optIn: true })
      const s = me.player.stats!
      return `${h1}: ${s.duelWins} duel wins, ${s.playersBeaten} beaten, ${s.wildWins} wild wins, ${s.catches} catches, ${s.speciesCollected} species, ${s.marketSales} sales`
    })

    await step('a passkey saved, then the same collection, listings and stats on another machine', async () => {
      const auth = await softAuthenticator()
      const add = await p2.call('passkeyStart', {})
      const pageOf = async (url: string) => {
        const html = await (await fetch(url)).text()
        const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)![1]!
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        return { ticket: attr('data-ticket'), options: JSON.parse(attr('data-options')) as never }
      }
      const post = (path: string, body: unknown) => fetch(`${boot.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const a = await pageOf(add.url)
      assert.equal((await post('/passkey/add/finish', { ticket: a.ticket, ...(await auth.create(a.options, boot.origin)) })).status, 200)
      assert.deepEqual(await p2.call('authPoll', { pollId: add.pollId }), { status: 'added' })
      const t2 = (await p2.me()).player.team
      const listedCard = (await cardsOf(p2)).find(c => free(c, clock.now(), t2) && c.species.startsWith('s'))!
      const listing = (await p2.call('listCard', { cardId: listedCard.id, price: 12 })).listing
      const warned = async () => (await p2.me()).notices.filter(n => n.kind === 'new-device' && n.text === NOTICE_TEXT.newDevice()).length
      const warnedBefore = await warned()
      const laptop = connect(boot, 'p2-laptop', 'haiku')
      const start = await laptop.call('authStart', {})
      const s = await pageOf(start.url)
      assert.equal((await post('/passkey/signin/finish', { ticket: s.ticket, ...(await auth.get(s.options, boot.origin)) })).status, 200)
      const done = await laptop.call('authPoll', { pollId: start.pollId })
      assert.ok(done.status === 'done')
      laptop.token = done.token
      const there = await laptop.me()
      const here = await p2.me()
      assert.deepEqual([there.player.handle, there.player.stats, there.listings!.map(l => l.id)], [here.player.handle, here.player.stats, [listing.id]])
      assert.equal((await laptop.call('cancelListing', { listingId: listing.id })).listing.state, 'cancelled', 'the other machine acts as the same player')
      assert.equal(await warned(), warnedBefore + 1, 'the account is told a new device signed in')
      assert.deepEqual(await laptop.call('devices', {}), { sessions: 2, passkeys: 1 })
      return `${there.player.handle} on a second machine, ${there.player.stats!.marketSales} sales and its listing there too`
    })

    let handles: string[] = []
    await step('handle reroll', async () => {
      const old = (await p1.me()).player.handle
      const { handle, handleRerollFrom } = await p1.call('rerollHandle', {})
      assert.notEqual(handle, old)
      assert.equal(handleRerollFrom, utcDay(clock.now() + ECONOMY.handleRerollMs))
      assert.equal((await p1.me()).player.handle, handle)
      await p2.fails('profile', { handle: old }, 'not_found')
      assert.equal((await p2.call('profile', { handle })).handle, handle)
      await p1.fails('rerollHandle', {}, 'rate_limited')
      handles = [firstHandle, old, handle]
      return `${old} became ${handle}`
    })

    await step('delete the account, totally', async () => {
      const { id } = (await boot.db.get<{ id: string }>('SELECT id FROM players WHERE handle = ?', handles.at(-1)!))!
      // an offer still waiting for the leaving player: its card must come home to its sender
      const t2 = (await p2.me()).player.team
      const waiting = (await cardsOf(p2)).find(c => free(c, clock.now(), t2))!
      await p2.call('offer', { to: handles.at(-1)!, give: [waiting.id], get: [] })
      assert.deepEqual(await p1.call('deleteMe', {}), { deleted: true })
      await p1.fails('me', {}, 'unauthorized')
      await p1.fails('cards', {}, 'unauthorized')
      assert.equal((await cardsOf(p2)).find(c => c.id === waiting.id)?.state, 'owned', 'the waiting offer\'s card came home')
      const back = (await p2.me()).notices.find(n => n.kind === 'offer-declined')
      assert.ok(back && back.handle === undefined, 'the sender is told, without the leaver\'s handle')
      const left = await residue(boot.db, [id, ...new Set(handles)], (table, column) => table === 'retired_handles' && column === 'handle')
      assert.deepEqual(left, [], 'nothing anywhere still names the deleted player')
      const retired = await boot.db.all<{ handle: string }>('SELECT handle FROM retired_handles')
      assert.ok(retired.some(r => r.handle === handles.at(-1)), 'the last handle stays taken for 30 days')
      // what was traded or given away stays with its new owner
      assert.ok((await cardsOf(p2)).some(c => c.id === mine.id))
      assert.ok((await cardsOf(p3)).some(c => c.id === giftCard.id))
      await p2.fails('profile', { handle: handles.at(-1)! }, 'not_found')
      assert.ok(!(await p2.call('leaderboard', {})).top.some(r => handles.includes(r.handle)))
      return 'no row, cell or JSON field names the player any more'
    })

    assert.deepEqual(boot.errors, [], 'the server logged no unexpected error')
  } finally {
    await boot.close()
  }
  const requests = p1.wire.length + p2.wire.length + p3.wire.length
  return { steps, ms: Math.round(performance.now() - began), requests, foil: foilCards }
}

/** The plainest free cards that pay for a deal, or null. */
function pickFor(deal: TraderDeal, pool: readonly Card[]): Card[] | null {
  const fits = pool.filter(c => (!deal.give.family || c.family === deal.give.family) && (!deal.give.rarity || c.rarity === deal.give.rarity))
  return fits.length >= deal.give.count ? fits.slice(0, deal.give.count) : null
}

// ---------- the command line ----------

const self = fileURLToPath(import.meta.url)
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && same(resolve(process.argv[1]), self)) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const difficulty = flag('--difficulty')
  const keep = flag('--keep')
  const storage = args.includes('--d1') ? 'd1' as const : 'sqlite' as const
  runE2E({ ...(difficulty ? { difficulty: Number(difficulty) } : {}), ...(keep ? { file: resolve(keep) } : {}), storage, log: line => console.log(line) })
    .then(r => console.log(`\n${r.steps.length} steps passed in ${r.ms} ms over ${r.requests} HTTP requests`))
    .catch(err => {
      console.error(err instanceof Error ? err.stack ?? err.message : err)
      process.exitCode = 1
    })
}

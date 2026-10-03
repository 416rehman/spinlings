// Drops (SPEC 25, 33): scripts/admin/drop.ts plans, previews and stores drops (Node SQLite directly,
// D1 through wrangler), and POST /v1/redeem hands them out: personal DNA, binding, supply, one per
// account, unique codes stored only hashed, and wrong or closed codes answering alike.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeDropCode } from '../../plugin/hooks/core/drops.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { openDatabase } from '../../server/src/node.ts'
import {
  commands, createDrop, createOptions, d1Target, endDrop, inline, insertStmts, listDrops, literal, localTarget,
  parseArgs, planDrop, previewDrop, rewardFromFlags, uniqueCode, wranglerRows,
} from '../../scripts/admin/drop.ts'
import type { CreateOptions, Io } from '../../scripts/admin/drop.ts'
import { stmt } from '../../server/src/db.ts'
import { DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import { trust } from './social-helpers.ts'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dir = mkdtempSync(join(tmpdir(), 'spinlings-drops-'))
/** SQLite handles to close before the files can go (Windows keeps open files) */
const handles: { close(): void }[] = []
after(() => {
  for (const h of handles) try { h.close() } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true })
})
let files = 0
/** a fresh, migrated Node database file */
const dbFile = () => {
  const file = join(dir, `drops-${files++}.db`)
  openDatabase(file).sqlite.close()
  return file
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
function ioAt(now: number, answers?: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { now, randomBytes: random, out: s => { out.push(s) }, err: s => { err.push(s) } }
  if (answers) io.ask = async () => answers.shift() ?? ''
  return { io, out, err }
}

const EGG = { type: 'egg', promo: { seed: 'founders-2026', name: 'Glimmerkin', family: 'fable', rarity: 'rare', foil: true, stamp: "Founder's · Oct 2026" } }
const founders = (o: Partial<CreateOptions> = {}): CreateOptions => ({
  code: 'FOUNDERS', reward: [EGG, { type: 'pack', count: 1 }], starts: T0 - HOUR, ends: T0 + 7 * DAY, ...o,
})

describe('planning a drop', () => {
  it('a public code: stored normalised and hashed, bound, one per account, the reward checked', () => {
    const { rows, codes } = planDrop(founders({ code: 'found-ers' }), { now: T0, randomBytes: random })
    assert.deepEqual(codes, ['FOUNDERS'])
    const r = rows[0]!
    assert.deepEqual(
      { ...r, id: r.id.slice(0, 2) },
      {
        id: 'd-', code_hash: sha256Hex('FOUNDERS'), code_plain: 'FOUNDERS', kind: 'public', reward_json: JSON.stringify([EGG, { type: 'pack', count: 1 }]),
        supply: null, per_account: 1, bound: 1, starts_at: T0 - HOUR, ends_at: T0 + 7 * DAY, created_at: T0,
      },
    )
  })

  it('unique codes: single-use, 60 random bits each, kept only as hashes', () => {
    const { rows, codes } = planDrop(founders({ code: undefined, unique: 50, prefix: 'golden', reward: { type: 'card', rarity: 'epic' } }), { now: T0, randomBytes: random })
    assert.equal(new Set(codes).size, 50)
    for (const c of codes) assert.match(c, /^GOLDEN-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
    assert.ok(12 * Math.log2(32) >= 60)
    const batch = rows[0]!.id.slice(0, rows[0]!.id.lastIndexOf('-'))
    for (const [i, r] of rows.entries()) {
      assert.deepEqual([r.code_plain, r.supply, r.kind, r.code_hash], [null, 1, 'unique', sha256Hex(normalizeDropCode(codes[i]!))])
      assert.ok(r.id.startsWith(batch + '-'))
    }
    assert.ok(!JSON.stringify(rows).includes(codes[0]!.slice(7)), 'no row carries a code')
    // the symbols are drawn evenly: every one of the 32 shows up
    const symbols = new Set(Array.from({ length: 200 }, () => uniqueCode('X', random).slice(2).replaceAll('-', '')).join(''))
    assert.equal(symbols.size, 32)
  })

  it('refuses a bad reward, a blocked name, an unbound public drop, a closed window and odd codes', () => {
    const plan = (o: Partial<CreateOptions>) => () => planDrop(founders(o), { now: T0, randomBytes: random })
    assert.throws(plan({ reward: { ...EGG, extra: 1 } }), /unknown key/)
    assert.throws(plan({ reward: { type: 'egg', promo: { ...EGG.promo, name: 'Pikachu' } } }), /blocked/)
    assert.throws(plan({ reward: { type: 'pack', count: 4 } }), /out of range/)
    assert.throws(plan({ reward: Array.from({ length: 9 }, () => ({ type: 'pack', count: 1 })) }), /more than 8/)
    assert.throws(plan({ tradeable: true }), /stay bound/)
    assert.doesNotThrow(plan({ tradeable: true, supply: 100 }))
    assert.throws(plan({ ends: T0 - 1 }), /already be over/)
    assert.throws(plan({ starts: T0 + DAY, ends: T0 + DAY }), /end after/)
    assert.throws(plan({ code: 'NO!' }), /letters and digits/)
    assert.throws(plan({ code: 'AB' }), /at least 3/)
    assert.throws(plan({ unique: 3 }), /either --code or --unique/)
    assert.throws(plan({ code: undefined, unique: 3, supply: 5 }), /good once/)
  })

  it('builds the reward from flags, or asks for it in the terminal', async () => {
    const flags = parseArgs(['create', '--egg', 'Glimmerkin', '--family', 'fable', '--stamp', 'Founder', '--foil', '--packs', '2', '--card', 'rare', '--card-family', 'opus']).flags
    assert.deepEqual(rewardFromFlags(flags, n => new Uint8Array(n)), [
      { type: 'egg', promo: { seed: '0000000000000000', name: 'Glimmerkin', family: 'fable', rarity: 'rare', foil: true, stamp: 'Founder' } },
      { type: 'pack', count: 2 },
      { type: 'card', rarity: 'rare', family: 'opus' },
    ])
    assert.throws(() => rewardFromFlags(parseArgs(['create']).flags, random), /Nothing to give/)
    assert.throws(() => parseArgs(['create', '--code']), /needs a value/)
    const { io } = ioAt(T0, ['unique 3', 'Moonpip', 'haiku', '', 'Night Owl', 'y', '1'])
    const o = await createOptions(new Map(), io)
    assert.deepEqual([o.unique, o.code, o.starts, o.ends], [3, undefined, T0, T0 + 7 * DAY])
    assert.deepEqual((o.reward as unknown[]).map(x => (x as { type: string }).type), ['egg', 'pack'])
    assert.deepEqual((o.reward as typeof EGG[])[0]!.promo, { ...(o.reward as typeof EGG[])[0]!.promo, name: 'Moonpip', family: 'haiku', rarity: 'rare', foil: true, stamp: 'Night Owl' })
  })
})

describe('SQL for wrangler', () => {
  it('writes values in as literals that survive quotes and anything else in admin text', () => {
    assert.equal(literal(null), 'NULL')
    assert.equal(literal(42), '42')
    assert.equal(literal("it's"), "'it''s'")
    assert.throws(() => literal(1.5))
    assert.throws(() => literal('a\u0000b'))
    assert.equal(inline(stmt("SELECT '?', ? AS x", "a'?")), "SELECT '?', 'a''?' AS x")
    assert.throws(() => inline(stmt('SELECT ?')), /more placeholders/)
    assert.throws(() => inline({ sql: 'SELECT 1', params: [1] }), /more parameters/)
    const tricky = planDrop(founders({ reward: { type: 'egg', promo: { ...EGG.promo, stamp: "x'); DROP TABLE drops; --" } } }), { now: T0, randomBytes: random })
    const { sqlite } = openDatabase(dbFile())
    handles.push(sqlite)
    for (const sql of commands(insertStmts(tricky.rows))) sqlite.exec(sql)
    const stored = sqlite.prepare('SELECT reward_json FROM drops').get() as { reward_json: string }
    assert.equal(JSON.parse(stored.reward_json).promo.stamp, "x'); DROP TABLE drops; --")
  })

  it('splits long batches into commands that fit a command line', () => {
    const many = planDrop(founders({ code: undefined, unique: 300, reward: [EGG, EGG, EGG] }), { now: T0, randomBytes: random })
    const parts = commands(insertStmts(many.rows), 8000)
    assert.ok(parts.length > 1 && parts.every(p => p.length <= 8000))
    assert.equal(parts.join(';\n').split('INSERT INTO drops').length - 1, 300)
  })

  it('runs wrangler d1 execute with the admin’s login: remote by default, wrangler’s local copy on request', async () => {
    const calls: string[][] = []
    const rows = [{ id: 'd-1', kind: 'public', code_plain: 'HELLO', supply: 10, redeemed: 3, bound: 1, starts_at: T0, ends_at: T0 + DAY }]
    const fake = async (args: readonly string[]) => {
      calls.push([...args])
      return args.includes('--json') ? `[{"results":${JSON.stringify(rows)},"success":true}]` : ''
    }
    const remote = d1Target('spinlings', { run: fake })
    await remote.run(insertStmts(planDrop(founders(), { now: T0, randomBytes: random }).rows))
    assert.deepEqual(calls[0]!.slice(0, 6), ['d1', 'execute', 'spinlings', '--remote', '--yes', '--command'])
    assert.match(calls[0]![6]!, /^INSERT INTO drops/)
    assert.deepEqual(await listDrops(remote, T0 + HOUR), ['d-1  public  HELLO  live  3 redeemed, 7 left  bound  2026-10-02T12:00Z to 2026-10-03T12:00Z'])
    assert.deepEqual(calls[1]!.slice(0, 6), ['d1', 'execute', 'spinlings', '--remote', '--yes', '--json'])
    await d1Target('other', { local: true, persistTo: '.wrangler/x', run: fake }).all('SELECT 1')
    assert.deepEqual(calls[2]!.slice(0, 7), ['d1', 'execute', 'other', '--local', '--persist-to', '.wrangler/x', '--yes'])
    assert.deepEqual(wranglerRows('▲ some banner\n[{"results":[{"a":1}]},{"results":[{"b":2}]}]'), [{ b: 2 }])
  })
})

describe('previews', () => {
  it('draw the promo creature as minted and as four redeemers’ copies, as a PNG and in the terminal', async () => {
    const p = await previewDrop([EGG] as never, random)
    assert.deepEqual([...p.png!.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.match(p.text, /Glimmerkin, fable rare foil/)
    assert.match(p.text, /\x1b\[38;2;\d+;\d+;\d+/)
    const legend = await previewDrop({ type: 'egg', promo: { ...EGG.promo, rarity: 'legendary' } } as never, random)
    assert.match(legend.text, /\(final form\)/)
    assert.equal((await previewDrop({ type: 'pack', count: 2 }, random)).png, null)
  })
})

describe('the admin script on a Node database, with POST /v1/redeem', () => {
  it('creates, lists and ends drops, and players redeem them once each with their own DNA', async () => {
    const file = dbFile()
    const target = localTarget(file)
    handles.push({ close: () => target.close!() })
    const { io, out } = ioAt(T0)
    await createDrop(founders(), target, io, { yes: true, previewFile: join(dir, 'p.png') })
    assert.ok(out.includes('Live: FOUNDERS'))
    await assert.rejects(createDrop(founders(), target, io, { yes: true, previewFile: join(dir, 'p.png') }), /already a drop/)
    const limited = await createDrop(founders({ code: 'LIMITED', supply: 1, tradeable: true, reward: { type: 'card', rarity: 'rare', family: 'opus' } }), target, io, { yes: true })
    const golden = await createDrop(founders({ code: undefined, unique: 2, reward: { type: 'pack', count: 1, family: 'haiku' } }), target, io, { yes: true })
    assert.ok(limited && golden)
    assert.ok(out.some(l => l.includes(golden.codes[0]!) && l.includes(golden.codes[1]!)), 'codes printed once')
    const dropsJson = JSON.stringify(await target.all('SELECT * FROM drops'))
    for (const c of golden.codes) assert.ok(!dropsJson.includes(normalizeDropCode(c)) && !dropsJson.includes(c), 'unique codes are not stored')

    const opened = openDatabase(file)
    handles.push(opened.sqlite)
    const s = server({ db: opened.db })
    const [p, q, r] = [await s.join(), await s.join(), await s.join()]
    const mine = await p.call('redeem', { code: 'founders' })
    assert.equal(mine.cards.length, 1)
    assert.deepEqual(mine.packs.map(k => k.source), ['promo'])
    const egg = mine.cards[0]!
    assert.deepEqual([egg.species, egg.origin, egg.bound, egg.foil, egg.form!.kind, egg.form!.stamp, egg.form!.names], ['promo', 'promo', true, true, 'promo', "Founder's · Oct 2026", ['Glimmerkin', 'Glimmerkin', 'Glimmerkin']])
    const theirs = (await q.call('redeem', { code: 'FOUND-ERS' })).cards[0]!
    assert.deepEqual(theirs.form, egg.form, 'the same creature for everyone')
    assert.notEqual(theirs.dna, egg.dna, 'with personal DNA')
    assert.equal((await p.fails('redeem', { code: 'FOUNDERS' })).code, 'conflict')
    // a bound promo never leaves its first owner
    await trust(s, p)
    for (const [op, req] of [['gift', { cardId: egg.id }], ['recycle', { cardId: egg.id }], ['offer', { to: q.me.player.handle, give: [egg.id], get: [] }]] as const) {
      assert.equal((await p.fails(op, req as never)).code, 'not_allowed', op)
    }
    // supply, and unique codes good once in all
    assert.equal((await p.call('redeem', { code: 'LIMITED' })).cards[0]!.bound, false)
    assert.deepEqual([(await q.fails('redeem', { code: 'LIMITED' })).code], ['cap_reached'])
    await q.call('redeem', { code: golden.codes[0]! })
    assert.equal((await r.fails('redeem', { code: golden.codes[0]!.toLowerCase() })).code, 'cap_reached')
    await r.call('redeem', { code: golden.codes[1]! })

    // rows made in the same millisecond list in id order, so look lines up by what they say
    const lines = await listDrops(target, T0)
    assert.equal(lines.length, 3)
    for (const re of [/FOUNDERS {2}live {2}2 redeemed, no limit {2}bound/, /LIMITED {2}live {2}1 redeemed, 0 left {2}tradeable/, /unique {2}2 unique codes {2}live {2}2 redeemed, 0 left/]) {
      assert.equal(lines.filter(l => re.test(l)).length, 1, String(re))
    }

    // ending: confirmed in the terminal, then a closed code answers exactly like a wrong one (an hour
    // on, as this address has used its 10 redeem attempts for this one)
    s.tick(HOUR)
    const asked = ioAt(T0, ['n'])
    assert.equal(await endDrop(target, 'FOUNDERS', asked.io), 0)
    assert.equal(await endDrop(target, 'founders', ioAt(T0).io, true), 1)
    await assert.rejects(endDrop(target, 'FOUNDERS', ioAt(T0).io, true), /No open drop/)
    const answer = async (code: string) => {
      const res = await s.request('POST', '/v1/redeem', { token: r.token, body: { code } })
      return `${res.status} ${await res.text()}`
    }
    assert.equal(await answer('FOUNDERS'), await answer('NOSUCHCODE'))
    assert.match(await answer('FOUNDERS'), /^404 /)
    const batch = golden.rows[0]!.id.slice(0, golden.rows[0]!.id.lastIndexOf('-'))
    assert.equal(await endDrop(target, batch, ioAt(T0).io, true), 2)
    assert.ok((await listDrops(target, T0 + 1)).some(l => / unique codes {2}ended /.test(l)))
  })

  it('runs from the command line, refusing to write without a confirmation', () => {
    const file = dbFile()
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', 'scripts/admin/drop.ts', ...args], { cwd: ROOT, encoding: 'utf8' })
    const refused = run('create', '--local', '--db', file, '--code', 'HELLO', '--packs', '1')
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /add --yes/)
    const made = run('create', '--local', '--db', file, '--code', 'HELLO', '--packs', '1', '--supply', '5', '--yes', '--preview', join(dir, 'cli.png'))
    assert.equal(made.status, 0, made.stderr)
    assert.match(made.stdout, /Live: HELLO/)
    const listed = run('list', '--local', '--db', file)
    assert.match(listed.stdout, /HELLO {2}live {2}0 redeemed, 5 left {2}bound/)
    assert.equal(run('list', '--local', '--db', join(dir, 'missing.db')).status, 1)
    assert.equal(run('--help').status, 0)
    const { sqlite } = openDatabase(file)
    handles.push(sqlite)
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM drops').get() as { n: number }).n, 1)
  })
})

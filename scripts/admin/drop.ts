// Drops (SPEC 25, 33): the admin's own tool, run on their own machine. There is no admin API and no
// admin token: this script writes the drops table directly, on Cloudflare D1 through wrangler with
// the admin's own Cloudflare login, or in a Node server's SQLite file. Codes are printed once;
// unique codes are kept only as hashes, so nobody, the admin included, can read them back later.
//
//   node scripts/admin/drop.ts create [options]   asks for what is missing when run in a terminal
//   node scripts/admin/drop.ts list
//   node scripts/admin/drop.ts end <drop id | batch | code>
//
// Where (every command)
//   --d1 <name>        the D1 database (default spinlings), remote; add --d1-local for wrangler's local
//                      dev copy (and --persist-to <dir> if wrangler dev uses one)
//   --local            the Node server's SQLite instead; --db <file> (default $SPINLINGS_DB, then
//                      server/data/spinlings.db)
// create
//   --code <CODE>      a public vanity code, e.g. FOUNDERS (its /d/ page shows it)   --kind public|creator
//   --unique <n>       n single-use codes of 60 random bits each, e.g. GOLDEN-7Q2M-K9XD-4HTR (--prefix GOLDEN)
//   --egg <Name> --family <f> --stamp <text> [--rarity rare] [--foil] [--seed <seed>]   a promo creature
//   --packs <1-3> [--pack-family <f>]   --card <rarity> [--card-family <f>]   more in the same drop
//   --reward <json>    the whole reward instead, checked like any other
//   --supply <n>       redemptions in all (each unique code is good once)
//   --days <n>         open for n days (default 7), or --ends <ISO time>; --starts <ISO time> (default now)
//   --tradeable        the cards may be traded: fixed-supply drops only, public drops stay bound
//   --preview <file>   where the PNG preview goes (default .dev/drop-preview.png)
//   --dry-run          preview and print the SQL, change nothing       --yes   no confirmation
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dropItems, normalizeDropCode, promoForm } from '../../plugin/hooks/core/drops.ts'
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import { DROP_CODE_RE, parseDropReward } from '../../plugin/hooks/core/schemas.ts'
import { sha256Hex, toHex } from '../../plugin/hooks/core/sha256.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import type { DropReward, DropRewardItem, PromoEgg } from '../../plugin/hooks/core/types.ts'
import { stmt } from '../../server/src/db.ts'
import type { SqlValue, Stmt } from '../../server/src/db.ts'
import { openDatabase } from '../../server/src/node.ts'
import { createCanvas, encodePng } from '../../server/src/png.ts'
import type { DropRow } from '../../server/src/schema.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DAY = 86_400_000
const MAX_UNIQUE = 1000
/** 32 symbols with no 0/O or 1/I to misread: 5 bits each, so 12 of them carry 60 bits (SPEC 25) */
const SYMBOLS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PREFIX_RE = /^[A-Z][A-Z0-9]{0,11}$/

export type Io = {
  now: number
  randomBytes(n: number): Uint8Array
  out(text: string): void
  err(text: string): void
  /** a question in the terminal; absent when nobody is there to answer */
  ask?(question: string): Promise<string>
  /** runs wrangler with these arguments and returns its stdout */
  wrangler?: Runner
}

// ---- arguments ---------------------------------------------------------------------------------

const BOOLEAN = new Set(['local', 'd1-local', 'foil', 'tradeable', 'dry-run', 'yes', 'help'])

export type Args = { command: string; positional: string[]; flags: Map<string, string | true> }

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) { positional.push(a); continue }
    const name = a.slice(2)
    if (BOOLEAN.has(name)) { flags.set(name, true); continue }
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
    flags.set(name, value)
  }
  return { command: positional.shift() ?? '', positional, flags }
}

const text = (f: Args['flags'], name: string): string | undefined => {
  const v = f.get(name)
  return typeof v === 'string' ? v : undefined
}

function whole(v: string | undefined, name: string, min: number, max: number): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`)
  return n
}

function time(v: string, name: string): number {
  const t = Date.parse(v)
  if (!Number.isFinite(t)) throw new Error(`${name} must be a date and time, e.g. 2026-10-08T00:00:00Z`)
  return t
}

// ---- planning a drop ---------------------------------------------------------------------------

export type CreateOptions = {
  /** a public vanity code; or `unique` codes */
  code?: string
  unique?: number
  prefix?: string
  kind?: 'public' | 'creator'
  reward: unknown
  supply?: number
  starts: number
  ends: number
  tradeable?: boolean
}

export type DropInsert = Omit<DropRow, 'redeemed'>
export type Plan = { rows: DropInsert[]; codes: string[]; reward: DropReward; label: string }

/** A unique code: the prefix and three groups of four symbols, e.g. GOLDEN-7Q2M-K9XD-4HTR. */
export function uniqueCode(prefix: string, randomBytes: (n: number) => Uint8Array): string {
  const s = [...randomBytes(12)].map(b => SYMBOLS[b & 31]).join('')
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** Checks everything and makes the rows, without touching any database. */
export function planDrop(o: CreateOptions, io: Pick<Io, 'now' | 'randomBytes'>): Plan {
  const reward = parseDropReward(o.reward)
  if ((o.code === undefined) === (o.unique === undefined)) throw new Error('Give either --code or --unique')
  if (!(o.starts < o.ends)) throw new Error('The drop must end after it starts')
  if (o.ends <= io.now) throw new Error('The drop would already be over')
  if (o.supply !== undefined && (!Number.isInteger(o.supply) || o.supply < 1)) throw new Error('--supply must be at least 1')
  if (o.unique !== undefined && o.supply !== undefined) throw new Error('Each unique code is good once: leave out --supply')
  const limited = o.unique !== undefined || o.supply !== undefined
  if (o.tradeable && !limited) throw new Error('Public drops stay bound (SPEC 25): give --supply for a tradeable drop')
  const base = {
    reward_json: JSON.stringify(reward), per_account: 1, bound: o.tradeable ? 0 : 1, starts_at: o.starts, ends_at: o.ends, created_at: io.now,
  }
  if (o.code !== undefined) {
    if (o.code.length > 40 || !DROP_CODE_RE.test(o.code)) throw new Error('A code is letters and digits, with single dashes or spaces between groups')
    const plain = normalizeDropCode(o.code)
    if (plain.length < 3) throw new Error('A code needs at least 3 letters or digits')
    const kind = o.kind ?? 'public'
    return {
      rows: [{ ...base, id: `d-${toHex(io.randomBytes(5))}`, code_hash: sha256Hex(plain), code_plain: plain, kind, supply: o.supply ?? null }],
      codes: [plain], reward, label: plain,
    }
  }
  const n = o.unique!
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNIQUE) throw new Error(`--unique must be from 1 to ${MAX_UNIQUE}`)
  const prefix = (o.prefix ?? 'GOLDEN').toUpperCase()
  if (!PREFIX_RE.test(prefix)) throw new Error('--prefix is a letter and up to 11 more letters or digits')
  const batch = `u-${toHex(io.randomBytes(5))}`
  const codes = [...new Set(Array.from({ length: n }, () => uniqueCode(prefix, io.randomBytes)))]
  if (codes.length !== n) throw new Error('Two codes came out the same: run it again')
  const width = String(n).length
  return {
    rows: codes.map((code, i) => ({
      ...base, id: `${batch}-${String(i + 1).padStart(width, '0')}`, code_hash: sha256Hex(normalizeDropCode(code)), code_plain: null, kind: 'unique', supply: 1,
    })),
    codes, reward, label: `${batch} (${n} unique code${n === 1 ? '' : 's'})`,
  }
}

/** The reward from flags: an egg, packs and a card, or --reward JSON; checked later by the strict schema. */
export function rewardFromFlags(f: Args['flags'], randomBytes: (n: number) => Uint8Array): unknown {
  const json = text(f, 'reward')
  if (json !== undefined) {
    try {
      return JSON.parse(json) as unknown
    } catch {
      throw new Error('--reward is not valid JSON')
    }
  }
  const items: unknown[] = []
  const egg = text(f, 'egg')
  if (egg !== undefined) {
    items.push({
      type: 'egg',
      promo: {
        seed: text(f, 'seed') ?? toHex(randomBytes(8)), name: egg, family: text(f, 'family'), rarity: text(f, 'rarity') ?? 'rare',
        foil: f.get('foil') === true, stamp: text(f, 'stamp'),
      },
    })
  }
  const packs = whole(text(f, 'packs'), '--packs', 0, 3)
  if (packs) items.push({ type: 'pack', count: packs, ...(text(f, 'pack-family') ? { family: text(f, 'pack-family') } : {}) })
  const card = text(f, 'card')
  if (card !== undefined) items.push({ type: 'card', rarity: card, ...(text(f, 'card-family') ? { family: text(f, 'card-family') } : {}) })
  if (!items.length) throw new Error('Nothing to give: add --egg, --packs, --card or --reward')
  return items.length === 1 ? items[0] : items
}

/** create's options from flags, asking in the terminal for a code and a reward when they are missing. */
export async function createOptions(f: Args['flags'], io: Io): Promise<CreateOptions> {
  const flags = new Map(f)
  if (!flags.has('code') && !flags.has('unique') && io.ask) {
    const answer = (await io.ask('Code (a word such as FOUNDERS, or "unique 100"): ')).trim()
    const m = /^unique\s+(\d+)$/i.exec(answer)
    if (m) flags.set('unique', m[1]!)
    else if (answer) flags.set('code', answer)
  }
  if (!['reward', 'egg', 'packs', 'card'].some(k => flags.has(k)) && io.ask) {
    const name = (await io.ask('Promo creature name (empty for none): ')).trim()
    if (name) {
      flags.set('egg', name)
      flags.set('family', (await io.ask(`Family (${FAMILIES.join(', ')}): `)).trim())
      flags.set('rarity', (await io.ask('Rarity (common, rare, epic, legendary) [rare]: ')).trim() || 'rare')
      flags.set('stamp', (await io.ask('Stamp, e.g. Founder · Oct 2026: ')).trim())
      if (/^y/i.test((await io.ask('Foil? [y/N] ')).trim())) flags.set('foil', true)
    }
    const packs = (await io.ask('Packs too (0-3) [0]: ')).trim()
    if (packs && packs !== '0') flags.set('packs', packs)
    if (!flags.has('unique') && !flags.has('supply')) {
      const supply = (await io.ask('Supply (empty for no limit): ')).trim()
      if (supply) flags.set('supply', supply)
    }
  }
  const starts = text(flags, 'starts') !== undefined ? time(text(flags, 'starts')!, '--starts') : io.now
  const days = whole(text(flags, 'days'), '--days', 1, 365)
  const ends = text(flags, 'ends') !== undefined ? time(text(flags, 'ends')!, '--ends') : starts + (days ?? 7) * DAY
  const kind = text(flags, 'kind')
  if (kind !== undefined && kind !== 'public' && kind !== 'creator') throw new Error('--kind is public or creator')
  const o: CreateOptions = { reward: rewardFromFlags(flags, io.randomBytes), starts, ends, tradeable: flags.get('tradeable') === true }
  const code = text(flags, 'code')
  const unique = whole(text(flags, 'unique'), '--unique', 1, MAX_UNIQUE)
  const supply = whole(text(flags, 'supply'), '--supply', 1, 1e9)
  const prefix = text(flags, 'prefix')
  if (code !== undefined) o.code = code
  if (unique !== undefined) o.unique = unique
  if (supply !== undefined) o.supply = supply
  if (prefix !== undefined) o.prefix = prefix
  if (kind !== undefined) o.kind = kind
  return o
}

// ---- preview -----------------------------------------------------------------------------------

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const

/** Sprites side by side as terminal half blocks in true colour, two pixel rows per line. */
export function terminalSprites(sprites: readonly Pixels[], gap = 2): string {
  const rows = Math.max(...sprites.map(px => px.length))
  const lines: string[] = []
  for (let r = 0; r < rows; r += 2) {
    let line = ''
    for (const px of sprites) {
      for (let c = 0; c < (px[0]?.length ?? 0); c++) {
        const top = px[r]?.[c] ?? -1, bottom = px[r + 1]?.[c] ?? -1
        if (top < 0 && bottom < 0) line += ' '
        else if (top < 0) line += `\x1b[38;2;${rgb(bottom).join(';')}m▄\x1b[0m`
        else if (bottom < 0) line += `\x1b[38;2;${rgb(top).join(';')}m▀\x1b[0m`
        else line += `\x1b[38;2;${rgb(top).join(';')};48;2;${rgb(bottom).join(';')}m▀\x1b[0m`
      }
      line += ' '.repeat(gap)
    }
    lines.push(line.trimEnd())
  }
  return lines.join('\n')
}

function describe(item: DropRewardItem): string {
  if (item.type === 'egg') {
    const p = item.promo
    return `Egg: ${p.name}, ${p.family} ${p.rarity}${p.foil ? ' foil' : ''}, stamped "${p.stamp}" (seed ${p.seed})`
  }
  if (item.type === 'pack') return `${item.count} pack${item.count === 1 ? '' : 's'} (${item.family ?? 'any family'})`
  return `A ${item.rarity} card (${item.family ?? 'any family'})`
}

export type Preview = { text: string; png: Uint8Array | null }

/**
 * The promo creature as everyone's copy starts (each stage, or its one final form), then four
 * redeemers' copies with their own DNA, as a PNG and in the terminal.
 */
export async function previewDrop(reward: DropReward, randomBytes: (n: number) => Uint8Array): Promise<Preview> {
  const items = dropItems(reward)
  const lines = items.map(describe)
  const eggs = items.filter((i): i is { type: 'egg'; promo: PromoEgg } => i.type === 'egg')
  if (!eggs.length) return { text: lines.join('\n'), png: null }
  const SCALE = 6, CELL = 16 * SCALE + 16
  const strips = eggs.map(e => {
    const form = promoForm(e.promo)
    const stages = form.legendary ? [3 as const] : [1 as const, 2 as const, 3 as const]
    const plain = stages.map(stage => spriteFor({ form, stage }))
    const copies = Array.from({ length: 4 }, () => {
      const b = randomBytes(4)
      const dna = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0
      return spriteFor({ species: 'promo', form, dna, shiny: false, rarity: e.promo.rarity, stage: stages[0]! })
    })
    return { promo: e.promo, sprites: [...plain, ...copies], plain: plain.length }
  })
  const width = 16 + Math.max(...strips.map(s => s.sprites.length)) * CELL
  const canvas = createCanvas(width, strips.length * (CELL + 24) + 8, '#1b1d24')
  strips.forEach((s, i) => {
    const y = 8 + i * (CELL + 24)
    canvas.drawText(16, y, `${s.promo.name} · ${s.promo.stamp}`, '#efece4', 2)
    s.sprites.forEach((px, k) => {
      const x = 16 + k * CELL + (k >= s.plain ? 8 : 0)
      canvas.drawPixels(x, y + 24, px.map(row => row.map(c => (c < 0 ? null : [...rgb(c), 255] as const))), SCALE)
    })
  })
  for (const s of strips) lines.push('', `${s.promo.name}: as minted${s.plain > 1 ? ', at stages 1 to 3' : ' (final form)'}, then four redeemers' copies`, terminalSprites(s.sprites))
  return { text: lines.join('\n'), png: await encodePng(canvas) }
}

// ---- where drops live --------------------------------------------------------------------------

export type Runner = (args: readonly string[]) => Promise<string>

export type Target = {
  readonly name: string
  run(stmts: readonly Stmt[]): Promise<void>
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>
  close?(): void
}

/** wrangler from this repo's node_modules, run by this same node: no shell, so arguments pass verbatim. */
export const wrangler: Runner = args => new Promise((done, reject) => {
  const bin = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js')
  if (!existsSync(bin)) return reject(new Error('wrangler is not installed: run npm ci --ignore-scripts first'))
  const child = spawn(process.execPath, [bin, ...args], {
    cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  let out = ''
  child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d })
  child.on('error', reject)
  child.on('close', (code: number | null) => (code === 0 ? done(out) : reject(new Error(`wrangler failed (exit ${code})${out.trim() ? `: ${out.trim().slice(0, 400)}` : ''}`))))
})

/** A SQL literal: wrangler's --command takes no bound parameters, so values are quoted here. */
export function literal(v: SqlValue): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`not a whole number: ${v}`)
    return String(v)
  }
  if (v.includes('\u0000')) throw new Error('text with a NUL character')
  return `'${v.replaceAll("'", "''")}'`
}

/** A statement with its parameters written in as literals. */
export function inline(s: Stmt): string {
  let out = '', i = 0, quoted = false
  for (const ch of s.sql) {
    if (ch === "'") quoted = !quoted
    if (ch === '?' && !quoted) {
      if (i >= s.params.length) throw new Error('more placeholders than parameters')
      out += literal(s.params[i++]!)
    } else out += ch
  }
  if (i !== s.params.length) throw new Error('more parameters than placeholders')
  return out
}

/** Statements joined into commands of at most `max` characters (the Windows command line is ~32 K). */
export function commands(stmts: readonly Stmt[], max = 8000): string[] {
  const out: string[] = []
  let cur = ''
  for (const sql of stmts.map(inline)) {
    if (cur && cur.length + sql.length + 2 > max) { out.push(cur); cur = '' }
    cur += (cur ? ';\n' : '') + sql
  }
  if (cur) out.push(cur)
  return out
}

/** The rows of the last statement in `wrangler d1 execute --json` output. */
export function wranglerRows<T>(stdout: string): T[] {
  const start = stdout.indexOf('[')
  if (start < 0) throw new Error('wrangler gave no JSON')
  const parsed = JSON.parse(stdout.slice(start)) as { results?: T[] }[]
  return parsed.at(-1)?.results ?? []
}

export function d1Target(database: string, o: { local?: boolean; persistTo?: string; run?: Runner } = {}): Target {
  const run = o.run ?? wrangler
  const where = [o.local ? '--local' : '--remote', ...(o.persistTo ? ['--persist-to', o.persistTo] : [])]
  const exec = (sql: string, json: boolean) => run(['d1', 'execute', database, ...where, '--yes', ...(json ? ['--json'] : []), '--command', sql])
  return {
    name: `D1 ${database} (${o.local ? 'wrangler local' : 'remote'})`,
    async run(stmts) {
      for (const sql of commands(stmts)) await exec(sql, false)
    },
    async all<T>(sql: string, ...params: SqlValue[]) {
      return wranglerRows<T>(await exec(inline(stmt(sql, ...params)), true))
    },
  }
}

export function localTarget(file: string): Target {
  if (!existsSync(file)) throw new Error(`No database at ${file}: start the Node server once, or give --db <file>`)
  const { sqlite, db } = openDatabase(file)
  return {
    name: `SQLite ${file}`,
    async run(stmts) { await db.batch(stmts) },
    all: <T>(sql: string, ...params: SqlValue[]) => db.all<T>(sql, ...params),
    close: () => sqlite.close(),
  }
}

export function targetOf(f: Args['flags'], io: Io): Target {
  if (f.get('local') === true) {
    return localTarget(resolve(text(f, 'db') ?? process.env.SPINLINGS_DB ?? resolve(ROOT, 'server/data/spinlings.db')))
  }
  const persistTo = text(f, 'persist-to')
  return d1Target(text(f, 'd1') ?? 'spinlings', {
    local: f.get('d1-local') === true, ...(persistTo ? { persistTo } : {}), ...(io.wrangler ? { run: io.wrangler } : {}),
  })
}

// ---- the commands ------------------------------------------------------------------------------

const COLUMNS = ['id', 'code_hash', 'code_plain', 'kind', 'reward_json', 'supply', 'per_account', 'bound', 'starts_at', 'ends_at', 'created_at'] as const

export function insertStmts(rows: readonly DropInsert[]): Stmt[] {
  return rows.map(r => stmt(`INSERT INTO drops (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`, ...COLUMNS.map(c => r[c])))
}

const iso = (t: number) => new Date(t).toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z')

/** Plans, previews, confirms and inserts a drop; prints the codes once, after they are stored. */
export async function createDrop(o: CreateOptions, target: Target, io: Io, x: { dryRun?: boolean; yes?: boolean; previewFile?: string } = {}): Promise<Plan | null> {
  const plan = planDrop(o, io)
  const preview = await previewDrop(plan.reward, io.randomBytes)
  io.out(preview.text)
  if (preview.png) {
    const file = resolve(x.previewFile ?? resolve(ROOT, '.dev/drop-preview.png'))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, preview.png)
    io.out(`Preview: ${file}`)
  }
  const first = plan.rows[0]!
  io.out([
    '',
    `Drop ${plan.label} on ${target.name}`,
    `  ${first.kind}, ${first.bound ? 'bound' : 'tradeable'}, ${first.supply === null ? 'no supply limit' : o.unique ? 'each code once' : `supply ${first.supply}`}`,
    `  open ${iso(first.starts_at)} to ${iso(first.ends_at)}`,
  ].join('\n'))
  const stmts = insertStmts(plan.rows)
  // a dry run touches no database at all
  if (x.dryRun) {
    io.out(commands(stmts).join(';\n') + ';')
    return null
  }
  if (o.code !== undefined && (await target.all<{ id: string }>('SELECT id FROM drops WHERE code_hash = ?', first.code_hash)).length) {
    throw new Error(`${plan.codes[0]} is already a drop`)
  }
  if (!x.yes) {
    if (!io.ask) throw new Error('Nobody to confirm: add --yes')
    if (!/^y/i.test((await io.ask('Insert it? [y/N] ')).trim())) {
      io.out('Nothing changed.')
      return null
    }
  }
  await target.run(stmts)
  io.out(o.unique === undefined
    ? `Live: ${plan.codes[0]}`
    : `Codes (shown this once, only their hashes are stored):\n${plan.codes.join('\n')}`)
  return plan
}

type ListRow = Pick<DropRow, 'id' | 'kind' | 'code_plain' | 'supply' | 'redeemed' | 'bound' | 'starts_at' | 'ends_at'>

/** One line per drop, unique-code batches as one: redemptions, what is left and whether it is open. */
export async function listDrops(target: Target, now: number): Promise<string[]> {
  const rows = await target.all<ListRow>('SELECT id, kind, code_plain, supply, redeemed, bound, starts_at, ends_at FROM drops ORDER BY created_at, id')
  const groups = new Map<string, ListRow[]>()
  for (const r of rows) {
    const key = r.kind === 'unique' ? r.id.slice(0, r.id.lastIndexOf('-')) : r.id
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  if (!groups.size) return ['No drops yet.']
  return [...groups].map(([key, list]) => {
    const r = list[0]!
    const redeemed = list.reduce((n, x) => n + x.redeemed, 0)
    const supply = list.every(x => x.supply !== null) ? list.reduce((n, x) => n + x.supply!, 0) : null
    const status = now < r.starts_at ? 'upcoming' : now < r.ends_at ? 'live' : 'ended'
    const what = r.kind === 'unique' ? `${list.length} unique code${list.length === 1 ? '' : 's'}` : r.code_plain ?? '(no code)'
    const left = supply === null ? 'no limit' : `${supply - redeemed} left`
    return `${key}  ${r.kind}  ${what}  ${status}  ${redeemed} redeemed, ${left}  ${r.bound ? 'bound' : 'tradeable'}  ${iso(r.starts_at)} to ${iso(r.ends_at)}`
  })
}

/** Closes a drop (by id or code) or a whole unique batch now; returns how many rows closed (0: left as is). */
export async function endDrop(target: Target, ref: string, io: Pick<Io, 'now' | 'ask' | 'out'>, yes = false): Promise<number> {
  const like = `${ref.replace(/[\\%_]/g, c => `\\${c}`)}-%`
  const where = `(id = ? OR id LIKE ? ESCAPE '\\' OR code_plain = ?) AND ends_at > ?`
  const params = [ref, like, normalizeDropCode(ref), io.now]
  const open = await target.all<{ id: string }>(`SELECT id FROM drops WHERE ${where}`, ...params)
  if (!open.length) throw new Error(`No open drop matches ${ref}`)
  if (!yes) {
    if (!io.ask) throw new Error('Nobody to confirm: add --yes')
    if (!/^y/i.test((await io.ask(`Close ${open.length} drop row(s) on ${target.name} now? [y/N] `)).trim())) return 0
  }
  await target.run([stmt(`UPDATE drops SET ends_at = ? WHERE ${where}`, io.now, ...params)])
  return open.length
}

export const USAGE = `Usage: node scripts/admin/drop.ts create|list|end [options] (see the top of this file)
  create --code FOUNDERS --egg Glimmerkin --family fable --rarity rare --foil --stamp "Founder · Oct 2026" --packs 1 --days 7
  create --unique 100 --prefix GOLDEN --card epic --days 3 --tradeable
  list --local --db server/data/spinlings.db
  end FOUNDERS`

export async function main(argv: readonly string[], io: Io): Promise<number> {
  let target: Target | undefined
  try {
    const args = parseArgs(argv)
    if (args.flags.get('help') === true || !['create', 'list', 'end'].includes(args.command)) {
      io.out(USAGE)
      return args.flags.get('help') === true ? 0 : 1
    }
    target = targetOf(args.flags, io)
    if (args.command === 'create') {
      const previewFile = text(args.flags, 'preview')
      await createDrop(await createOptions(args.flags, io), target, io, {
        dryRun: args.flags.get('dry-run') === true, yes: args.flags.get('yes') === true, ...(previewFile ? { previewFile } : {}),
      })
    } else if (args.command === 'list') {
      for (const line of await listDrops(target, io.now)) io.out(line)
    } else {
      const ref = args.positional[0] ?? ''
      if (!ref) throw new Error('end needs a drop id, a batch or a code')
      io.out(`Closed ${await endDrop(target, ref, io, args.flags.get('yes') === true)} drop row(s).`)
    }
    return 0
  } catch (err) {
    io.err(`drop: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    target?.close?.()
  }
}

const self = fileURLToPath(import.meta.url)
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && same(resolve(process.argv[1]), self)) {
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null
  const io: Io = {
    now: Date.now(),
    randomBytes: n => crypto.getRandomValues(new Uint8Array(n)),
    out: s => console.log(s),
    err: s => console.error(s),
    ...(rl ? { ask: (q: string) => rl.question(q) } : {}),
  }
  main(process.argv.slice(2), io).then(code => { process.exitCode = code }).finally(() => rl?.close())
}

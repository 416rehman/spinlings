// Opening several packs at once (openPacks, POST /v1/packs/open-many): openPack's rules in one guarded
// batch, every pack or none, first finds right across the packs, races settled exactly once, and each
// pack counted as a request in the token bucket (SPEC 6, 16, 26).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { API_ROUTES, FEATURES, OPEN_PACKS_MAX } from '../../plugin/hooks/core/api.ts'
import type { OpenedPack } from '../../plugin/hooks/core/api.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import type { Card, Family } from '../../plugin/hooks/core/types.ts'
import { Conflict } from '../../server/src/db.ts'
import type { Db, Stmt } from '../../server/src/db.ts'
import { setPlayer } from '../../server/src/game/ctx.ts'
import { grantPack } from '../../server/src/game/mint.ts'
import { openDatabase } from '../../server/src/node.ts'
import { RATES } from '../../server/src/ratelimit.ts'
import { ApiFailure, counts, server } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const FAMILIES: Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const WELCOME = ECONOMY.packs.welcome
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))

/** `n` unopened packs for the player, straight in the database (bought ones, unless bound). */
async function stock(s: Server, p: Player, n: number, o: { family?: Family; bound?: boolean } = {}): Promise<string[]> {
  const grants = Array.from({ length: n }, (_, i) =>
    grantPack({ now: s.now(), randomBytes: rand }, p.id, o.family ?? FAMILIES[i % 4]!, o.bound ? 'promo' : 'bought', { bound: o.bound === true }))
  for (let i = 0; i < grants.length; i += 50) await s.db.batch(grants.slice(i, i + 50).map(g => g.stmt))
  return grants.map(g => g.pack.id)
}

/** Every row of every table, in a stable order: "every table unchanged" (SPEC 26.7). */
async function snapshot(db: Db): Promise<string> {
  const tables = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  const out: Record<string, string[]> = {}
  for (const { name } of tables) out[name] = (await db.all(`SELECT * FROM "${name}"`)).map(r => JSON.stringify(r)).sort()
  return JSON.stringify(out)
}

const unopened = async (s: Server, p: Player) => (await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM packs WHERE owner_id = ?', p.id))!.n
const cardsOf = (opened: readonly OpenedPack[]): Card[] => opened.flatMap(o => o.cards)

/**
 * A database whose next `n` batches wait for one another, so n handlers have all read before any of
 * them writes: a real race, decided by the guards. `race` answers the run's result and how many batches lost.
 */
function racing(): { db: Db; race<T>(n: number, run: () => Promise<T>): Promise<[T, number]> } {
  const base = openDatabase(':memory:').db
  let need = 0, lost = 0
  let waiting: (() => void)[] = []
  const release = () => { need = 0; const go = waiting; waiting = []; for (const f of go) f() }
  const db: Db = {
    all: base.all,
    get: base.get,
    async batch(stmts) {
      if (need > 0) await new Promise<void>(resolve => { waiting.push(resolve); if (waiting.length >= need) release() })
      try {
        return await base.batch(stmts)
      } catch (err) {
        if (err instanceof Conflict) lost++
        throw err
      }
    },
  }
  return {
    db,
    async race(n, run) {
      need = n
      lost = 0
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; release() }, 30_000)
      try {
        const result = await run()
        assert.equal(timedOut, false, 'every racing handler reached its guarded batch')
        return [result, lost]
      } finally { clearTimeout(timer); release() }
    },
  }
}

const settle = (calls: Promise<unknown>[]) =>
  Promise.all(calls.map(c => c.then(() => 'ok', (e: unknown) => (e instanceof ApiFailure ? e.code : String(e)))))

describe('opening several packs at once', () => {
  it('is a POST with a session, listed in the server features', async () => {
    assert.deepEqual(API_ROUTES.openPacks, { method: 'POST', path: '/v1/packs/open-many', auth: true, offline: false })
    assert.ok(FEATURES.includes('open-many'))
    assert.ok((await server().call('version')).features.includes('open-many'))
  })

  it("opens every pack asked for, in request order, each with its family's cards, and the packs are gone", async () => {
    const s = server()
    const p = await s.join()
    const ids = await stock(s, p, OPEN_PACKS_MAX)
    const asked = [...ids].reverse()
    const before = await p.row()
    const { opened } = await p.call('openPacks', { packIds: asked })
    assert.deepEqual(opened.map(o => o.packId), asked)
    const left = new Set((await s.db.all<{ id: string }>('SELECT id FROM packs')).map(r => r.id))
    assert.ok(asked.every(id => !left.has(id)), 'no opened pack row is left behind')
    for (const [k, o] of opened.entries()) {
      assert.equal(o.family, FAMILIES[(OPEN_PACKS_MAX - 1 - k) % 4])
      assert.equal(o.cards.length, 1)
      assert.ok(o.cards.every(c => c.family === o.family && c.origin === 'pack' && c.state === 'owned' && !c.bound && c.lockedUntil === 0))
    }
    const got = cardsOf(opened)
    assert.equal(new Set(got.map(c => c.id)).size, got.length, 'every card has its own id')
    const held = new Map((await p.call('cards')).cards.map(c => [c.id, c]))
    for (const c of got) assert.deepEqual(held.get(c.id), c, 'the answer is the card as stored')
    const after = await p.row()
    assert.equal(after.cards_version, before.cards_version + 1, 'one collection change for the whole batch')
    assert.equal(after.version, before.version + 1)
    assert.equal((await p.call('me')).packs.length, WELCOME, 'the welcome packs are untouched')
  })

  it("opens a bound drop's packs as bound cards beside free ones", async () => {
    const s = server()
    const p = await s.join()
    const [bound] = await stock(s, p, 1, { bound: true })
    const [free] = await stock(s, p, 1)
    const { opened } = await p.call('openPacks', { packIds: [free!, bound!] })
    assert.deepEqual(opened.map(o => o.cards.every(c => c.bound)), [false, true])
  })

  it('opens a single pack exactly as openPack would', async () => {
    const s = server()
    const p = await s.join()
    const [pack] = (await p.call('me')).packs
    const { opened } = await p.call('openPacks', { packIds: [pack!.id] })
    assert.deepEqual(opened.map(o => [o.packId, o.family, o.cards.length]), [[pack!.id, pack!.family, 1]])
    assert.equal((await p.fails('openPack', { packId: pack!.id })).code, 'not_found')
  })

  it('stamps First Discovered once per species across the whole batch, and counts the album once', async () => {
    const s = server()
    const p = await s.join()
    const taken = new Set((await s.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
    const album = new Set((await s.db.all<{ species: string }>('SELECT species FROM album WHERE player_id = ?', p.id)).map(r => r.species))
    const before = await p.row()
    // ten cards from one family of nine species: at least one species comes twice
    const ids = await stock(s, p, OPEN_PACKS_MAX, { family: 'sonnet' })
    const got = cardsOf((await p.call('openPacks', { packIds: ids })).opened)
    assert.ok(new Set(got.map(c => c.species)).size < got.length, 'a species repeats in the batch')
    let firsts = 0
    for (const c of got) {
      const first = !taken.has(c.species)
      taken.add(c.species)
      if (first) firsts++
      assert.equal(c.firstFind === true, first, `${c.species}: First Discovered only on its first card`)
    }
    const rows = await s.db.all<{ species: string; card_id: string; player_id: string }>('SELECT species, card_id, player_id FROM firsts')
    assert.equal(rows.length, taken.size, 'one firsts row per species found')
    for (const c of got.filter(x => x.firstFind)) assert.ok(rows.some(r => r.card_id === c.id && r.player_id === p.id), c.species)
    const fresh = new Set(got.map(c => c.species).filter(sp => !album.has(sp)))
    const after = await p.row()
    assert.equal(after.first_finds, before.first_finds + firsts)
    assert.equal(after.species_count, before.species_count + fresh.size)
    assert.equal(after.s_species, before.s_species + fresh.size)
    assert.equal((await counts(s.db, ['album'])).album, album.size + fresh.size)
  })

  it('stays well inside D1 limits: one batch of bounded size, every statement under 100 parameters', async () => {
    const base = openDatabase(':memory:').db
    const batches: Stmt[][] = []
    const db: Db = { all: base.all, get: base.get, batch: stmts => { batches.push([...stmts]); return base.batch(stmts) } }
    const s = server({ db })
    const p = await s.join()
    const ids = await stock(s, p, OPEN_PACKS_MAX)
    batches.length = 0
    const got = cardsOf((await p.call('openPacks', { packIds: ids })).opened)
    const writes = batches.filter(b => b.some(x => x.sql.startsWith('INSERT INTO cards')))
    assert.equal(writes.length, 1, 'all of it commits in one batch')
    const firsts = got.filter(c => c.firstFind).length
    // per card: its row, the album's count and row, and for a first find its row and count; once: the
    // player and packs guards, the packs' delete, one publish, one season roll and the two version bumps
    assert.equal(writes[0]!.length, 7 + 3 * got.length + 2 * firsts)
    assert.ok(writes[0]!.length < 100)
    for (const st of writes[0]!) assert.ok(st.params.length < 100, st.sql)
  })
})

describe('refusals change nothing', () => {
  it("answers 404 for another player's pack, an opened one or a made-up one, all or nothing", async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const mine = await stock(s, b, 3)
    const theirs = (await a.call('me')).packs[0]!.id
    const done = (await b.call('openPacks', { packIds: [mine[2]!] })).opened[0]!.packId
    const made = 'abcdefghijklmnopqrstuvwxyz'
    const before = await snapshot(s.db)
    const answers: string[][] = []
    for (const bad of [theirs, done, made]) {
      for (const packIds of [[bad], [mine[0]!, bad], [bad, mine[1]!], [mine[0]!, mine[1]!, bad]]) {
        const err = await b.fails('openPacks', { packIds })
        assert.deepEqual([err.status, err.code], [404, 'not_found'], JSON.stringify(packIds))
        answers.push([String(err.status), err.code, err.message])
      }
    }
    assert.equal(new Set(answers.map(x => x.join(' '))).size, 1, 'a foreign, opened or made-up id answers alike')
    assert.equal(await snapshot(s.db), before)
    assert.equal(await unopened(s, b), WELCOME + 2)
  })

  it('refuses duplicates, an empty list, more than the most and card data before anything is read', async () => {
    const s = server()
    const p = await s.join()
    const ids = await stock(s, p, OPEN_PACKS_MAX + 1)
    const before = await snapshot(s.db)
    for (const body of [
      { packIds: [ids[0], ids[0]] },
      { packIds: [ids[0], ids[1], ids[0]] },
      { packIds: [] },
      { packIds: ids },
      { packIds: ids[0] },
      { packIds: [ids[0]], cards: [] },
      { packId: ids[0] },
      {},
    ]) {
      const res = await s.request('POST', '/v1/packs/open-many', { token: p.token, body })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    assert.equal(await snapshot(s.db), before)
  })

  it('needs a live session', async () => {
    const s = server()
    for (const token of [null, 'nope'.repeat(16)]) {
      const err = await s.call('openPacks', { packIds: ['x'] }, token).then(() => assert.fail('answered'), (e: ApiFailure) => e)
      assert.deepEqual([err.status, err.code], [401, 'unauthorized'])
    }
  })
})

describe('races, settled by guards (SPEC 16)', () => {
  it('opens a pack exactly once when a single open races a batch that holds it', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const ids = await stock(s, p, 4)
    const singles: Card[][] = [], batches: OpenedPack[][] = []
    const [results, lost] = await r.race(2, () => settle([
      p.call('openPack', { packId: ids[1]! }).then(x => { singles.push(x.cards) }),
      p.call('openPacks', { packIds: ids }).then(x => { batches.push(x.opened) }),
    ]))
    assert.equal(lost, 1)
    // whichever won, the other found a pack gone: the single one 404s, or the whole batch does
    assert.deepEqual(results.filter(x => x === 'ok').length, 1)
    assert.ok(results.every(x => x === 'ok' || x === 'not_found'), results.join())
    const minted = (await counts(s.db, ['cards'])).cards
    assert.equal(minted, 3 + (singles.length ? 1 : 4))
    assert.equal(await unopened(s, p), WELCOME + (singles.length ? 3 : 0))
    // the loser can open what is left: every pack opens once in all
    const left = (await p.call('me')).packs.filter(k => ids.includes(k.id)).map(k => k.id)
    if (left.length) await p.call('openPacks', { packIds: left })
    assert.equal((await counts(s.db, ['cards'])).cards, 3 + 4)
  })

  it('lets one of two identical batches through', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const ids = await stock(s, p, 5)
    const [results, lost] = await r.race(2, () => settle([p.call('openPacks', { packIds: ids }), p.call('openPacks', { packIds: [...ids].reverse() })]))
    assert.deepEqual([results.sort(), lost], [['not_found', 'ok'], 1])
    assert.equal((await counts(s.db, ['cards'])).cards, 3 + 5)
  })

  it('keeps first finds right when two batches race over the same new species', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const q = await s.join()
    const pi = await stock(s, p, OPEN_PACKS_MAX, { family: 'fable' })
    const qi = await stock(s, q, OPEN_PACKS_MAX, { family: 'fable' })
    const [results] = await r.race(2, () => settle([p.call('openPacks', { packIds: pi }), q.call('openPacks', { packIds: qi })]))
    assert.deepEqual(results, ['ok', 'ok'], 'the loser re-runs and succeeds')
    const firsts = await s.db.all<{ species: string; card_id: string }>('SELECT species, card_id FROM firsts')
    assert.equal(new Set(firsts.map(f => f.species)).size, firsts.length)
    const stamped = await s.db.all<{ id: string; species: string }>('SELECT id, species FROM cards WHERE first_find = 1')
    assert.deepEqual(stamped.map(c => c.id).sort(), firsts.map(f => f.card_id).sort(), 'every stamp has its firsts row and no species has two')
  })
})

describe('the token bucket counts each pack (SPEC 15)', () => {
  it(`allows ${5 * OPEN_PACKS_MAX} packs in 5 calls, and as many packs a minute as single opens would`, async () => {
    const s = server()
    const p = await s.join()
    await s.db.batch([setPlayer(p.id, { sparks: 0 })])
    const ids = await stock(s, p, 130)
    let spent = 1 // the join's first read
    let k = 0
    const next = () => ids.slice(k, (k += OPEN_PACKS_MAX))
    for (let i = 0; i < 5; i++) assert.equal((await p.call('openPacks', { packIds: next() })).opened.length, OPEN_PACKS_MAX)
    spent += 5 * OPEN_PACKS_MAX
    while (spent + OPEN_PACKS_MAX <= RATES.token!.capacity) {
      await p.call('openPacks', { packIds: next() })
      spent += OPEN_PACKS_MAX
    }
    const left = await unopened(s, p)
    const err = await p.fails('openPacks', { packIds: next() })
    assert.deepEqual([err.status, err.code], [429, 'rate_limited'])
    assert.ok(Number(err.headers.get('retry-after')) > 0, 'a wait comes with Retry-After')
    assert.equal(await unopened(s, p), left, 'nothing opened')
    s.tick(60_000)
    assert.equal((await p.call('openPacks', { packIds: ids.slice(k - OPEN_PACKS_MAX, k) })).opened.length, OPEN_PACKS_MAX, 'the bucket refills')
  })

  it('counts a single pack like openPack, and a malformed body as one request', async () => {
    const s = server()
    const p = await s.join()
    const ids = await stock(s, p, RATES.token!.capacity)
    let spent = 1
    for (; spent < RATES.token!.capacity; spent++) {
      const res = await s.request('POST', '/v1/packs/open-many', { token: p.token, body: spent % 2 ? { packIds: [ids[spent]] } : { packIds: 'x' } })
      assert.equal(res.status, spent % 2 ? 200 : 400)
    }
    assert.equal((await p.fails('openPacks', { packIds: [ids[0]!] })).code, 'rate_limited')
  })
})

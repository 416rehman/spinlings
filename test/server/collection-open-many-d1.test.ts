// Opening several packs at once over Cloudflare D1, run locally by wrangler's workerd (the real D1
// engine, in memory): the largest batch openPacks can make commits whole, and the guards settle a
// batch racing a single open. Skipped only when wrangler cannot start here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OPEN_PACKS_MAX } from '../../plugin/hooks/core/api.ts'
import { mintCard } from '../../plugin/hooks/core/cards.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import type { Family } from '../../plugin/hooks/core/types.ts'
import { seasonOf } from '../../plugin/hooks/core/world.ts'
import { Conflict } from '../../server/src/db.ts'
import type { Db, Stmt } from '../../server/src/db.ts'
import { deletePacks, packsGuard } from '../../server/src/game/collection.ts'
import { catalogOf, commit } from '../../server/src/game/ctx.ts'
import { grantPack, mintCards } from '../../server/src/game/mint.ts'
import { localD1 } from './d1-helpers.ts'
import { ApiFailure, DAY, server, T0 } from './scaffold-helpers.ts'

const local = await localD1()
const FAMILIES: Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))

/** Holds the next `n` batches until all have arrived, so every racer reads before any writes. */
function racing(base: Db) {
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
    async race<T>(n: number, run: () => Promise<T>): Promise<[T, number]> {
      need = n
      lost = 0
      const timer = setTimeout(release, 5000)
      try { return [await run(), lost] } finally { clearTimeout(timer) }
    },
  }
}

const settle = (calls: Promise<unknown>[]) =>
  Promise.all(calls.map(c => c.then(() => 'ok', (e: unknown) => (e instanceof ApiFailure ? e.code : String(e)))))

const count = async (db: Db, sql: string, ...params: string[]) => (await db.get<{ n: number }>(sql, ...params))!.n
const boughtPacks = (db: Db, playerId: string) => count(db, 'SELECT COUNT(*) AS n FROM packs WHERE owner_id = ? AND source = ?', playerId, 'bought')

if ('skip' in local) {
  describe('opening several packs over local D1', () => { it('runs', { skip: local.skip }, () => {}) })
} else {
  describe('opening several packs over local D1', () => {
    it('opens ten packs at once, again and again, with first finds right', async () => {
      const s = server({ db: local.db, now: T0 + 40 * DAY })
      const p = await s.join()
      for (let round = 0; round < 3; round++) {
        const grants = Array.from({ length: OPEN_PACKS_MAX }, (_, i) => grantPack({ now: s.now(), randomBytes: rand }, p.id, FAMILIES[i % 4]!, 'bought'))
        await local.db.batch(grants.map(g => g.stmt))
        const { opened } = await p.call('openPacks', { packIds: grants.map(g => g.pack.id) })
        assert.deepEqual(opened.map(o => o.packId), grants.map(g => g.pack.id))
      }
      const firsts = await local.db.all<{ species: string; card_id: string }>('SELECT species, card_id FROM firsts')
      assert.equal(new Set(firsts.map(f => f.species)).size, firsts.length)
      const stamped = await local.db.all<{ id: string }>('SELECT id FROM cards WHERE first_find = 1')
      assert.deepEqual(stamped.map(c => c.id).sort(), firsts.map(f => f.card_id).sort())
      assert.equal(await boughtPacks(local.db, p.id), 0)
    })

    it('commits the largest batch openPacks makes: ten packs, ten new species, ten First Discovered stamps', async () => {
      const s = server({ db: local.db, now: T0 + 50 * DAY })
      const p = await s.join()
      const now = s.now()
      const taken = new Set((await local.db.all<{ species: string }>('SELECT species FROM firsts')).map(r => r.species))
      const fresh = FAMILIES.flatMap(f => familySpecies(seasonOf(now), f, catalogOf(local.db))).filter(sp => !taken.has(sp.id)).slice(0, OPEN_PACKS_MAX)
      assert.equal(fresh.length, OPEN_PACKS_MAX, 'ten species nobody has found')
      const grants = fresh.map(sp => grantPack({ now, randomBytes: rand }, p.id, sp.family, 'bought'))
      await local.db.batch(grants.map(g => g.stmt))
      const ids = grants.map(g => g.pack.id)
      // exactly what the route commits, with every card a first find
      const minted = await mintCards({ db: local.db, now, randomBytes: rand }, p.id, fresh.map((species, i) =>
        mintCard({ species, rarity: species.legendary ? 'legendary' : 'common', shiny: false, dna: i + 1, origin: 'pack', now, foil: false }, catalogOf(local.db))))
      const row = await p.row()
      const stmts: Stmt[] = [packsGuard(p.id, ids), deletePacks(ids), ...minted.stmts]
      assert.ok(stmts.length + 2 < 100, `${stmts.length + 2} statements`)
      await commit({ db: local.db, player: row }, stmts)
      assert.ok(minted.cards.every(c => c.firstFind))
      assert.equal(await boughtPacks(local.db, p.id), 0)
      assert.equal((await p.row()).first_finds, row.first_finds + OPEN_PACKS_MAX)
      assert.equal(await count(local.db, 'SELECT COUNT(*) AS n FROM firsts WHERE player_id = ?', p.id), (await p.row()).first_finds)
    })

    it('opens a pack once when a single open races a batch that holds it, and a bad id leaves every pack', async () => {
      const r = racing(local.db)
      const s = server({ db: r.db, now: T0 + 60 * DAY })
      const p = await s.join()
      const grants = Array.from({ length: 4 }, (_, i) => grantPack({ now: s.now(), randomBytes: rand }, p.id, FAMILIES[i]!, 'bought'))
      await local.db.batch(grants.map(g => g.stmt))
      const ids = grants.map(g => g.pack.id)
      const [results, lost] = await r.race(2, () => settle([p.call('openPack', { packId: ids[2]! }), p.call('openPacks', { packIds: ids })]))
      assert.deepEqual([results.filter(x => x === 'ok').length, lost], [1, 1])
      assert.ok(results.every(x => x === 'ok' || x === 'not_found'), results.join())
      const left = await boughtPacks(local.db, p.id)
      assert.equal(left, results[0] === 'ok' ? 3 : 0)
      if (left) {
        const rest = ids.filter((_, i) => i !== 2)
        assert.equal((await p.fails('openPacks', { packIds: [...rest, ids[2]!] })).code, 'not_found')
        assert.equal(await boughtPacks(local.db, p.id), 3, 'all or nothing')
        assert.equal((await p.call('openPacks', { packIds: rest })).opened.length, 3)
      }
    })
  })
}

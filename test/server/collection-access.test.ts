// Who may touch what in the collection (SPEC 12, 16, 20, 26): the authorization matrix (another
// player's object is a 404 that changes nothing), enumeration, strict request bodies, races settled
// by guards, and what of a collection anyone else can ever see.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiOp } from '../../plugin/hooks/core/api.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { recycleValue } from '../../plugin/hooks/core/cards.ts'
import { mintFor, traderDeals } from '../../plugin/hooks/core/trader.ts'
import type { Card, Family, NewCard } from '../../plugin/hooks/core/types.ts'
import type { Db } from '../../server/src/db.ts'
import { Conflict, stmt } from '../../server/src/db.ts'
import { setPlayer } from '../../server/src/game/ctx.ts'
import { mintCards } from '../../server/src/game/mint.ts'
import { openDatabase } from '../../server/src/node.ts'
import { ApiFailure, counts, DAY, exact, FIRST_CHARGE, ROUTES, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
let seed = 0

async function give(s: Server, p: Player, cards: NewCard[]): Promise<Card[]> {
  const minted = await mintCards({ db: s.db, now: s.now(), randomBytes: rand }, p.id, cards)
  await s.db.batch(minted.stmts)
  return minted.cards
}

const card = (s: Server, family: Family = 'opus') => mintFor(family, 'common', rngFromSeed(`access/${seed++}`), s.now(), 'pack')
const ids = (cards: readonly { id: string }[]) => cards.map(c => c.id)

/** Every row of every table, in a stable order: "every table unchanged" (SPEC 26.7). */
async function snapshot(db: Db): Promise<string> {
  const tables = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  const out: Record<string, string[]> = {}
  for (const { name } of tables) out[name] = (await db.all(`SELECT * FROM "${name}"`)).map(r => JSON.stringify(r)).sort()
  return JSON.stringify(out)
}

/**
 * A database whose next `n` batches wait for one another, so n handlers have all read before any of
 * them writes: a real race, decided by the guards. Later batches (the retries) pass straight through.
 * `race` answers the run's result and how many batches lost (each a Conflict the app re-ran).
 */
function racing(): { db: Db; race<T>(n: number, run: () => Promise<T>): Promise<[T, number]> } {
  const base = openDatabase(':memory:').db
  let need = 0
  let lost = 0
  let waiting: (() => void)[] = []
  const release = () => { need = 0; const go = waiting; waiting = []; for (const f of go) f() }
  const db: Db = {
    all: base.all,
    get: base.get,
    async batch(stmts) {
      if (need > 0) {
        await new Promise<void>(resolve => {
          waiting.push(resolve)
          if (waiting.length >= need) release()
        })
      }
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
      // Cold fusion naming can exceed two seconds while the complete Node suite shares the CPU.
      // A watchdog must report an incomplete barrier, never silently turn the race into serial calls.
      const timer = setTimeout(() => { timedOut = true; release() }, 30_000)
      try {
        const result = await run()
        assert.equal(timedOut, false, 'Not every racing handler reached its guarded batch')
        return [result, lost]
      } finally { clearTimeout(timer); release() }
    },
  }
}

/** Settles each call to its answer or its error code. */
const settle = (calls: Promise<unknown>[]) =>
  Promise.all(calls.map(c => c.then(() => 'ok', (e: unknown) => (e instanceof ApiFailure ? e.code : String(e)))))

describe('the authorization matrix (SPEC 26)', () => {
  it("answers 404 for another player's card, pack or payment, changing nothing anywhere", async () => {
    const s = server()
    const a = await s.join('opus')
    const b = await s.join('haiku')
    await s.db.batch([setPlayer(a.id, { sparks: 10_000, joined: '2026-09-28', battles: 10 }), setPlayer(b.id, { sparks: 10_000, joined: '2026-09-28', battles: 10 })])
    const [theirs, theirs2] = await give(s, a, [card(s), card(s)])
    const [mine] = await give(s, b, [card(s)])
    const theirPack = (await a.call('me')).packs[0]!
    const deal = traderDeals(T0).find(d => d.give.count === 2)!
    const attempts: [ApiOp, Record<string, unknown>][] = [
      ['openPack', { packId: theirPack.id }],
      ['setTeam', { cardIds: [theirs!.id] }],
      ['setTeam', { cardIds: [mine!.id, theirs!.id] }],
      ['setForTrade', { cardId: theirs!.id, forTrade: true }],
      ['setForTrade', { cardId: theirs!.id, forTrade: false }],
      ['fuse', { cardId: theirs!.id, otherId: mine!.id }],
      ['fuse', { cardId: mine!.id, otherId: theirs!.id }],
      ['fuse', { cardId: theirs!.id, otherId: theirs2!.id }],
      ['recycle', { cardId: theirs!.id }],
      ['traderDeal', { dealId: deal.id, cardIds: [mine!.id, theirs!.id] }],
    ]
    const before = await snapshot(s.db)
    for (const [op, req] of attempts) {
      const err = await b.fails(op, req as never)
      assert.deepEqual([err.status, err.code], [404, 'not_found'], `${op} ${JSON.stringify(req)}`)
    }
    assert.equal(await snapshot(s.db), before)
  })

  it('answers a made-up id exactly like a foreign one, so ids reveal nothing', async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    const [theirs] = await give(s, a, [card(s)])
    const pack = (await a.call('me')).packs[0]!
    const made = 'abcdefghijklmnopqrstuvwxyz'
    const body = async (op: ApiOp, req: Record<string, unknown>) => {
      const err = await b.fails(op, req as never)
      return [err.status, err.code, err.message]
    }
    assert.deepEqual(await body('recycle', { cardId: theirs!.id }), await body('recycle', { cardId: made }))
    assert.deepEqual(await body('openPack', { packId: pack.id }), await body('openPack', { packId: made }))
    assert.deepEqual(await body('setForTrade', { cardId: theirs!.id, forTrade: false }), await body('setForTrade', { cardId: made, forTrade: false }))
  })
})

describe('requests', () => {
  const ops: [ApiOp, Record<string, unknown>][] = [
    ['cards', {}], ['chargePack', { family: 'opus' }], ['buyPack', { family: 'opus' }], ['openPack', { packId: 'x' }],
    ['setTeam', { cardIds: [] }], ['setForTrade', { cardId: 'x', forTrade: true }], ['fuse', { cardId: 'x', otherId: 'y' }],
    ['recycle', { cardId: 'x' }], ['craft', { speciesId: 's1-opus-0', rarity: 'common' }], ['setWishlist', { species: [] }],
    ['trader', {}], ['traderDeal', { dealId: '2026-10-02-0', cardIds: ['x'] }], ['redeem', { code: 'FOUNDERS' }],
  ]

  it('need a live session: no token, or a made-up one, is a bare 401', async () => {
    const s = server()
    for (const [op, req] of ops) {
      for (const token of [null, 'nope'.repeat(16)]) {
        const err = await s.call(op, req as never, token).then(() => assert.fail(op), (e: ApiFailure) => e)
        assert.deepEqual([err.status, err.code], [401, 'unauthorized'], op)
      }
    }
  })

  it('refuse unknown keys, card data and wrong types before anything is read', async () => {
    const s = server()
    const p = await s.join()
    const before = await snapshot(s.db)
    const bodies: [string, string, unknown][] = [
      ['POST', '/v1/packs/charge', { family: 'opus', count: 3 }],
      ['POST', '/v1/packs/charge', { family: 'dragon' }],
      ['POST', '/v1/packs/buy', {}],
      ['POST', '/v1/packs/open', { packId: 'x', cards: [] }],
      ['PUT', '/v1/team', { cardIds: 'abc' }],
      ['PUT', '/v1/team', { cardIds: ['a/b'] }],
      ['POST', '/v1/cards/x/for-trade', { forTrade: 1 }],
      ['POST', '/v1/cards/x/fuse', { otherId: 'y', level: 10 }],
      ['POST', '/v1/cards/x/recycle', { value: 9999 }],
      ['POST', '/v1/craft', { speciesId: 's1-opus-0', rarity: 'common', stats: { hp: 999, atk: 999, def: 999, spd: 999 } }],
      ['POST', '/v1/craft', { speciesId: 's1-opus-0', rarity: 'mythic' }],
      ['POST', '/v1/craft', { speciesId: 'mythic', rarity: 'legendary' }],
      ['PUT', '/v1/wishlist', { species: ['s1-opus-0'], extra: true }],
      ['POST', `/v1/trader/${traderDeals(T0)[0]!.id}`, { cardIds: Array.from({ length: 11 }, (_, i) => `c${i}`) }],
      ['POST', '/v1/trader/2026-10-02-0', { cardIds: [], dna: 1 }],
      ['POST', '/v1/redeem', { code: 'FOUNDERS', promo: {} }],
    ]
    for (const [method, path, body] of bodies) {
      const res = await s.request(method, path, { token: p.token, body })
      assert.equal(res.status, 400, `${method} ${path} ${JSON.stringify(body)}`)
    }
    const huge = await s.request('PUT', '/v1/wishlist', { token: p.token, body: { species: ['s1-opus-0'], pad: 'x'.repeat(20_000) } })
    assert.equal(huge.status, 413)
    assert.equal(await snapshot(s.db), before)
  })

  it('every collection operation has the route the wire contract gives it', () => {
    for (const [op] of ops) assert.equal(ROUTES[op].auth, true, op)
  })
})

describe('races, settled by guards (SPEC 16)', () => {
  it('opens a pack once however many requests race for it', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const pack = (await p.call('me')).packs[0]!
    const [results, lost] = await r.race(3, () => settle([0, 1, 2].map(() => p.call('openPack', { packId: pack.id }))))
    assert.deepEqual([results.sort(), lost], [['not_found', 'not_found', 'ok'], 2])
    assert.equal((await counts(s.db, ['cards'])).cards, 3 + 5)
  })

  it('pays a recycle once, and lets one of two fusions over a shared parent through', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    await s.db.batch([setPlayer(p.id, { sparks: 1000 })])
    const [x, y, z, w] = await give(s, p, [card(s), card(s), card(s), card(s)])
    const [recycled, lost] = await r.race(2, () => settle([p.call('recycle', { cardId: x!.id }), p.call('recycle', { cardId: x!.id })]))
    assert.deepEqual([recycled.sort(), lost], [['not_found', 'ok'], 1])
    const paid = 1000 + recycleValue(x!)
    assert.equal((await p.call('me')).player.sparks, paid)
    const [fusions, lostFuse] = await r.race(2, () => settle([p.call('fuse', { cardId: y!.id, otherId: z!.id }), p.call('fuse', { cardId: w!.id, otherId: y!.id })]))
    assert.deepEqual([fusions.sort(), lostFuse], [['not_found', 'ok'], 1])
    assert.equal((await p.call('me')).player.sparks, paid - 40)
    assert.equal((await counts(s.db, ['fusions'])).fusions, 1)
  })

  it('accepts one of two racing charges, and makes one deal once', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    s.tick(FIRST_CHARGE)
    const [charged, lost] = await r.race(2, () => settle([p.call('chargePack', { family: 'opus' }), p.call('chargePack', { family: 'fable' })]))
    assert.deepEqual([charged.sort(), lost], [['ok', 'rate_limited'], 1])
    assert.equal((await p.call('me')).packs.filter(k => k.source === 'charge').length, 1)
    const deal = traderDeals(T0).find(d => d.give.count === 2)!
    const one = await give(s, p, [card(s, deal.give.family), card(s, deal.give.family)])
    const two = await give(s, p, [card(s, deal.give.family), card(s, deal.give.family)])
    const [made, lostDeal] = await r.race(2, () => settle([p.call('traderDeal', { dealId: deal.id, cardIds: ids(one) }), p.call('traderDeal', { dealId: deal.id, cardIds: ids(two) })]))
    assert.deepEqual([made.sort(), lostDeal], [['conflict', 'ok'], 1])
    assert.equal((await counts(s.db, ['trader_uses'])).trader_uses, 1)
  })

  it('never spends sparks twice: two buys racing for the last 150', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    await s.db.batch([setPlayer(p.id, { sparks: 150 })])
    const [bought, lost] = await r.race(2, () => settle([p.call('buyPack', { family: 'opus' }), p.call('buyPack', { family: 'haiku' })]))
    assert.deepEqual([bought.sort(), lost], [['insufficient_sparks', 'ok'], 1])
    const me = await p.call('me')
    assert.deepEqual([me.player.sparks, me.packs.length], [0, 3])
  })

  it('keeps a recycled card off the team, whichever of team and recycle wins', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const [x] = await give(s, p, [card(s)])
    const [, lost] = await r.race(2, () => settle([p.call('setTeam', { cardIds: [x!.id] }), p.call('recycle', { cardId: x!.id })]))
    assert.equal(lost, 1)
    const me = await p.call('me')
    const have = new Set(ids((await p.call('cards')).cards))
    assert.ok(me.player.team.every(id => have.has(id)), 'the team holds only cards that exist')
    assert.equal((await p.row()).team_size, me.player.team.length)
  })

  it('gives the last unit of a drop to one of two racing players, and one redemption to a player racing themselves', async () => {
    const r = racing()
    const s = server({ db: r.db })
    const p = await s.join()
    const q = await s.join()
    const reward = JSON.stringify({ type: 'card', rarity: 'rare' })
    await s.db.batch([
      stmt(`INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, supply, starts_at, ends_at, created_at) VALUES ('d1', ?, 'LAST', 'public', ?, 1, 0, ?, 0)`, sha256Hex('LAST'), reward, T0 + DAY),
      stmt(`INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, starts_at, ends_at, created_at) VALUES ('d2', ?, 'MANY', 'public', ?, 0, ?, 0)`, sha256Hex('MANY'), reward, T0 + DAY),
    ])
    const [last, lostLast] = await r.race(2, () => settle([p.call('redeem', { code: 'LAST' }), q.call('redeem', { code: 'LAST' })]))
    assert.deepEqual([last.sort(), lostLast], [['cap_reached', 'ok'], 1])
    const [many, lostMany] = await r.race(2, () => settle([p.call('redeem', { code: 'MANY' }), p.call('redeem', { code: 'MANY' })]))
    assert.deepEqual([many.sort(), lostMany], [['conflict', 'ok'], 1])
    assert.deepEqual(await s.db.all('SELECT id, redeemed FROM drops ORDER BY id'), [{ id: 'd1', redeemed: 1 }, { id: 'd2', redeemed: 1 }])
  })
})

describe('what anyone else sees (SPEC 20)', () => {
  it("keeps a charge's family no longer than its pack, and charge times only for the last day", async () => {
    const s = server()
    const p = await s.join()
    s.tick(FIRST_CHARGE)
    const { packs } = await p.call('chargePack', { family: 'fable' })
    await p.call('openPack', { packId: packs.find(k => k.source === 'charge')!.id })
    assert.equal(await s.db.get(`SELECT 1 FROM packs WHERE source = 'charge'`), undefined)
    const { handle: _, ...row } = await p.row()
    assert.ok(!JSON.stringify(row).includes('fable'), 'the player row never holds the family')
    s.tick(DAY + 1)
    await p.call('chargePack', { family: 'haiku' })
    assert.deepEqual(JSON.parse((await p.row()).charges), [s.now()])
  })

  it("answers only the caller's own collection, in exactly the documented shapes", async () => {
    const s = server()
    const a = await s.join()
    const b = await s.join()
    await s.db.batch([setPlayer(a.id, { joined: '2026-09-28', battles: 10 })])
    const [c] = await give(s, a, [card(s)])
    await a.call('setForTrade', { cardId: c!.id, forTrade: true })
    const [hb, aid, bid] = [b.me.player.handle, a.id, b.id]
    for (const res of [await a.call('cards'), await a.call('trader'), await a.call('setWishlist', { species: ['s1-opus-1'] })]) {
      const text = JSON.stringify(res)
      for (const secret of [hb, aid, bid]) assert.ok(!text.includes(secret), 'nothing about any player rides along')
    }
    // the trade surfaces belong to the social routes; when they are in, a listed card shows as a public card only
    const res = await s.request('GET', `/v1/players/${a.me.player.handle}`, { token: b.token })
    if (res.status === 200) {
      const profile = exact('profile', await res.json())
      const listed = profile.forTrade.find(x => x.id === c!.id)!
      for (const k of ['forTrade', 'bound', 'origin', 'mintedAt', 'lockedUntil', 'tiredUntil', 'state', 'xp']) assert.ok(!(k in listed), k)
    }
  })
})

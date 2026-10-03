// Drops (SPEC 25): one row per drop, written by the admin script; POST /v1/redeem hatches the drop's
// promo creature with the redeemer's own DNA, once per player, inside its window and supply.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeDropCode } from '../../plugin/hooks/core/drops.ts'
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { stmt } from '../../server/src/db.ts'
import { counts, DAY, HOUR, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const egg = { type: 'egg', promo: { seed: 'founders-1', name: 'Emberwing', family: 'opus', rarity: 'rare', foil: true, stamp: 'Founder · Oct 2026' } }
let drops = 0

type DropSpec = { code: string; reward: unknown; unique?: boolean; supply?: number; bound?: boolean; starts?: number; ends?: number }

/** What scripts/admin/drop.ts inserts: a vanity code kept plain, or a unique code kept only as its hash. */
async function addDrop(s: Server, o: DropSpec): Promise<string> {
  const id = `drop-${drops++}`
  const normal = normalizeDropCode(o.code)
  await s.db.batch([stmt(
    `INSERT INTO drops (id, code_hash, code_plain, kind, reward_json, supply, bound, starts_at, ends_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, sha256Hex(normal), o.unique ? null : normal, o.unique ? 'unique' : 'public', JSON.stringify(o.reward), o.supply ?? null,
    o.bound ?? true, o.starts ?? T0 - DAY, o.ends ?? T0 + 7 * DAY, T0 - DAY,
  )])
  return id
}

const redeemed = async (s: Server, id: string) => (await s.db.get<{ redeemed: number }>('SELECT redeemed FROM drops WHERE id = ?', id))!.redeemed
const rawRedeem = (s: Server, p: Player, code: string, ip: string) => s.request('POST', '/v1/redeem', { token: p.token, body: { code }, ip })

describe('redeeming a drop', () => {
  it('hatches the same promo creature with personal DNA for every redeemer, once each, with its packs', async () => {
    const s = server()
    const id = await addDrop(s, { code: 'FOUNDERS', reward: [egg, { type: 'pack', family: 'opus', count: 1 }] })
    const p = await s.join()
    const q = await s.join()
    const mine = await p.call('redeem', { code: 'founders' })
    const [c] = mine.cards
    assert.deepEqual([c!.species, c!.form!.kind, c!.form!.stamp, c!.form!.names], ['promo', 'promo', 'Founder · Oct 2026', ['Emberwing', 'Emberwing', 'Emberwing']])
    assert.deepEqual([c!.family, c!.rarity, c!.foil, c!.bound, c!.origin, c!.level, c!.stage], ['opus', 'rare', true, true, 'promo', 1, 1])
    assert.deepEqual(mine.packs.map(k => [k.family, k.source]), [['opus', 'promo']])
    const opened = await p.call('openPack', { packId: mine.packs[0]!.id })
    assert.ok(opened.cards.every(x => x.bound), "a bound drop's pack opens bound cards")
    const theirs = (await q.call('redeem', { code: 'FOUNDERS' })).cards[0]!
    assert.deepEqual(theirs.form, c!.form)
    assert.notEqual(theirs.dna, c!.dna)
    assert.equal(await redeemed(s, id), 2)
    const again = await p.fails('redeem', { code: 'Founders' })
    assert.deepEqual([again.status, again.code], [409, 'conflict'])
    assert.equal(await redeemed(s, id), 2)
    assert.equal((await counts(s.db, ['redemptions'])).redemptions, 2)
  })

  it('finds a unique code by its hash alone, however it is typed, and mints tradeable cards from a tradeable drop', async () => {
    const s = server()
    await addDrop(s, { code: 'GOLDEN-7Q2M-K9XD', unique: true, bound: false, reward: { type: 'card', rarity: 'epic', family: 'fable' } })
    const p = await s.join()
    const { cards, packs } = await p.call('redeem', { code: 'golden 7q2m-k9xd' })
    assert.deepEqual(cards.map(c => [c.family, c.rarity, c.origin, c.bound, c.season]), [['fable', 'epic', 'promo', false, 1]])
    assert.deepEqual(packs, [])
    assert.equal((await s.db.get<{ code_plain: string | null }>('SELECT code_plain FROM drops'))!.code_plain, null)
  })

  it('stops at the supply, and answers a closed or wrong code exactly like a missing one', async () => {
    const s = server()
    await addDrop(s, { code: 'ONLYONE', supply: 1, reward: egg })
    await addDrop(s, { code: 'SOON', starts: T0 + HOUR, reward: egg })
    await addDrop(s, { code: 'OVER', ends: T0, reward: egg })
    const p = await s.join()
    const q = await s.join()
    await p.call('redeem', { code: 'ONLYONE' })
    const gone = await q.fails('redeem', { code: 'ONLYONE' })
    assert.deepEqual([gone.status, gone.code], [429, 'cap_reached'])
    const missing = await q.fails('redeem', { code: 'NOSUCHCODE' })
    assert.deepEqual([missing.status, missing.code], [404, 'not_found'])
    for (const code of ['SOON', 'OVER']) assert.equal((await q.fails('redeem', { code })).message, missing.message)
    s.tick(HOUR)
    assert.equal((await q.call('redeem', { code: 'soon' })).cards.length, 1)
  })

  it('counts every attempt, right or wrong, against the address and the token', async () => {
    const s = server()
    await addDrop(s, { code: 'FOUNDERS', reward: egg })
    const p = await s.join()
    const q = await s.join()
    for (let i = 0; i < 6; i++) assert.equal((await rawRedeem(s, p, `WRONG${i}`, '203.0.113.5')).status, 404)
    for (let i = 0; i < 4; i++) assert.equal((await rawRedeem(s, q, `WRONG${i}`, '203.0.113.5')).status, 404)
    const blocked = await rawRedeem(s, q, 'FOUNDERS', '203.0.113.5')
    assert.equal(blocked.status, 429, 'ten an hour from one address')
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    assert.equal((await rawRedeem(s, q, 'FOUNDERS', '203.0.113.6')).status, 200, 'another address may')
    for (let i = 0; i < 4; i++) assert.equal((await rawRedeem(s, p, `WRONG${i}`, `203.0.113.${20 + i}`)).status, 404)
    assert.equal((await rawRedeem(s, p, 'FOUNDERS', '203.0.113.40')).status, 429, 'ten an hour from one token')
    assert.equal((await counts(s.db, ['redemptions'])).redemptions, 1)
  })

  it('refuses to hand out a reward the strict admin schema rejects, minting nothing', async () => {
    const s = server()
    const blocked = await addDrop(s, { code: 'BADNAME', reward: { ...egg, promo: { ...egg.promo, name: 'Pikachu' } } })
    await addDrop(s, { code: 'TOOMANY', reward: Array(8).fill({ type: 'pack', count: 3 }) })
    await addDrop(s, { code: 'EXTRA', reward: { type: 'card', rarity: 'rare', sparkle: true } })
    const p = await s.join()
    const before = await counts(s.db, ['cards', 'packs', 'redemptions'])
    for (const code of ['BADNAME', 'TOOMANY', 'EXTRA']) {
      const err = await p.fails('redeem', { code })
      assert.deepEqual([err.status, err.code], [503, 'unavailable'], code)
    }
    assert.deepEqual(await counts(s.db, ['cards', 'packs', 'redemptions']), before)
    assert.equal(await redeemed(s, blocked), 0)
  })

  it('accepts only a plain code shape', async () => {
    const s = server()
    const p = await s.join()
    for (const code of ['', 'ab', 'FOUND ERS!', 'x'.repeat(41), 'FOUNDERS--1']) assert.equal((await p.fails('redeem', { code })).status, 400, code)
  })
})

// Execute released readers on real HTTP responses with a future move and rules version, rather
// than relying only on recordings from season 1. Repeated finishes exercise the stored answer too.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse, battleActionSchema } from '../../plugin/hooks/core/schemas.ts'
import { finishView } from '../../server/src/game/rules/wire.ts'
import { stmt } from '../../server/src/db.ts'
import { server } from '../server/scaffold-helpers.ts'
import type { Reader } from './harness.ts'

const fixtures = new URL('./fixtures/', import.meta.url)
const versions = readdirSync(fileURLToPath(fixtures), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)

describe('future battle compatibility', () => {
  for (const version of versions) it(`${version} reads a future authoritative special without changing its result`, async () => {
    const reader = await import(new URL(`${version}/schemas.ts`, fixtures).href) as Reader
    const s = server()
    const p = await s.join()
    const start = await p.call('startBattle', { kind: 'wild', family: 'haiku' })
    // Rules mismatch is how old mods choose server animation instead of running their own engine.
    const futureStart = { ...start, setup: { ...start.setup, rules: 2 } }
    assert.equal((reader.parseResponse('startBattle', JSON.parse(JSON.stringify(futureStart))) as typeof start).setup.rules, 2)
    s.set(start.finishAfter + 60_000)
    const done = await p.call('finishBattle', { battleId: start.id, inputs: [] })
    const future = structuredClone(done)
    const action = future.log.rounds[0]!.actions[0]!
    action.move = 'special'
    action.special = 'moonbeam' as never
    const projected = finishView(future)
    assert.equal(projected.log.rounds[0]!.actions[0]!.special, undefined)
    assert.equal(action.special, 'moonbeam', 'projection does not mutate the authoritative stored answer')
    const { special: _, ...sameAction } = action
    assert.deepEqual(projected.log.rounds[0]!.actions[0], sameAction)
    assert.deepEqual({ ...projected, log: undefined }, { ...future, log: undefined })
    assert.deepEqual(projected.log.maxHp, future.log.maxHp)
    assert.deepEqual(projected.log.rounds.map(r => r.hp), future.log.rounds.map(r => r.hp))
    await s.db.batch([stmt('UPDATE battles SET outcome = ? WHERE id = ?', JSON.stringify(future), start.id)])
    const response = await s.request('POST', `/v1/battles/${start.id}/finish`, { client: version, token: p.token, body: { inputs: [] } })
    assert.equal(response.status, 200)
    const wire = await response.json()
    assert.deepEqual(reader.parseResponse('finishBattle', wire), wire)
    assert.deepEqual(wire, projected)
  })

  it('the current reader uses a generic special for unknown labels and still rejects hostile values', () => {
    const base = { round: 1, side: 'a', slot: 0, targetSlot: 0, move: 'special', hits: 1, dmg: 6, crit: false, effect: 'normal', heal: 0, targetFainted: false, traits: [] }
    assert.deepEqual(parse(battleActionSchema, { ...base, special: 'moonbeam' }), base)
    assert.equal(parse(battleActionSchema, { ...base, special: 'flurry' }).special, 'flurry')
    for (const special of [null, 1, 'x'.repeat(25), '\u001b[31m', '<script>']) assert.throws(() => parse(battleActionSchema, { ...base, special }))
  })
})

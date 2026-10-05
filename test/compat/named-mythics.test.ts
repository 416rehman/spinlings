// Every released reader consumes real named-encounter, catch and collection answers without a wire upgrade.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { NAMED_MYTHICS } from '../../plugin/hooks/core/named-mythics.ts'
import type { StartBattleResponse } from '../../plugin/hooks/core/api.ts'
import { forceMythics, metWild } from '../server/named-mythics-helpers.ts'
import { server } from '../server/scaffold-helpers.ts'
import type { Reader } from './harness.ts'

it('all released mods retain named Mythic forms through encounter, catch and collection reads', async () => {
  await forceMythics(async () => {
    const s = server(), starts: unknown[] = []
    const players = []
    for (const entry of NAMED_MYTHICS) {
      const p = await s.join()
      await metWild(s, p)
      const response = await s.request('POST', '/v1/battles', { token: p.token, body: { kind: 'wild', family: 'haiku' } })
      assert.equal(response.status, 200)
      const start = await response.json() as StartBattleResponse
      assert.deepEqual(start.setup.defender[0]!.form!.names, [entry.name, entry.name, entry.name])
      starts.push(start); players.push(p)
    }
    const p = players[0]!, start = starts[0] as StartBattleResponse
    s.set(start.finishAfter + 60_000)
    const finishResponse = await s.request('POST', `/v1/battles/${start.id}/finish`, { token: p.token, body: { inputs: [] } })
    assert.equal(finishResponse.status, 200)
    const finish = await finishResponse.json()
    const catchResponse = await s.request('POST', `/v1/battles/${start.id}/catch`, { token: p.token, body: { index: 0 } })
    assert.equal(catchResponse.status, 200)
    const caught = await catchResponse.json() as { card: { id: string; form: { names: string[] } } }
    assert.equal(caught.card.form.names[2], 'Dario')
    const cardsResponse = await s.request('GET', '/v1/cards', { token: p.token })
    assert.equal(cardsResponse.status, 200)
    const cards = await cardsResponse.json()
    const fixtures = new URL('./fixtures/', import.meta.url)
    for (const version of readdirSync(fileURLToPath(fixtures), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
      const reader = await import(new URL(`${version}/schemas.ts`, fixtures).href) as Reader
      for (const wire of starts) assert.deepEqual(reader.parseResponse('startBattle', structuredClone(wire)), wire, `${version}: encounter`)
      assert.deepEqual(reader.parseResponse('finishBattle', structuredClone(finish)), finish, `${version}: finish`)
      assert.deepEqual(reader.parseResponse('catchCreature', structuredClone(caught)), caught, `${version}: catch`)
      assert.deepEqual(reader.parseResponse('cards', structuredClone(cards)), cards, `${version}: collection`)
    }
  })
})

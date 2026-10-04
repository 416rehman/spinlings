import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { CardsResponse, MeResponse, SeasonResponse, WorldResponse } from '../../plugin/hooks/core/api.ts'
import { seasonStart } from '../../plugin/hooks/core/world.ts'
import { stmt } from '../../server/src/db.ts'
import { server } from '../server/scaffold-helpers.ts'
import type { Reader } from './harness.ts'

const fixtures = new URL('./fixtures/', import.meta.url)
const versions = readdirSync(fileURLToPath(fixtures), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)

for (const version of versions) it(`${version} keeps old cards and reads a later season without updating`, async () => {
  const reader = await import(new URL(`${version}/schemas.ts`, fixtures).href) as Reader
  const s = server()
  const p = await s.join()
  const first = (await p.call('cards')).cards
  await s.db.batch([stmt('UPDATE players SET rating = 1900 WHERE id = ?', p.id)])
  s.set(seasonStart(12))
  const read = async <T>(op: string, path: string): Promise<T> => {
    const response = await s.request('GET', path, { client: version, token: p.token })
    assert.equal(response.status, 200)
    return reader.parseResponse(op, await response.json()) as T
  }
  const me = await read<MeResponse>('me', '/v1/me')
  const after = await read<CardsResponse>('cards', '/v1/cards')
  for (const card of first) assert.deepEqual(after.cards.find(c => c.id === card.id), card, 'old cards keep their DNA, stats and ownership')
  assert.deepEqual(me.player.team, p.me.player.team)
  assert.ok(me.player.rating > 0)
  const world = await read<WorldResponse>('world', '/v1/world')
  assert.equal(world.season, 12)
  const frozen = await read<SeasonResponse>('season', '/v1/season/12')
  assert.equal(frozen.species.length, 36)
  assert.ok(frozen.species.every(species => species.season === 12))
  await read<MeResponse>('me', '/v1/me')
  assert.deepEqual((await read<CardsResponse>('cards', '/v1/cards')).cards, after.cards, 'repeated visits do not pay another season card')
})

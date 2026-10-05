// Pack size is a game rule, not a new wire contract: released readers must accept a two-card answer,
// and the current reader must still accept an older server's five-card answer during rollout.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { OpenPackResponse } from '../../plugin/hooks/core/api.ts'
import { parseResponse } from '../../plugin/hooks/core/schemas.ts'
import { server } from '../server/scaffold-helpers.ts'
import type { Exchange, Flow, Reader } from './harness.ts'

const fixtures = new URL('./fixtures/', import.meta.url)
const versions = readdirSync(fileURLToPath(fixtures), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)

for (const version of versions) it(`${version} opens and keeps exactly two cards without updating`, async () => {
  const reader = await import(new URL(`${version}/schemas.ts`, fixtures).href) as Reader
  const s = server()
  const p = await s.join()
  const before = (await p.call('cards')).cards
  const pack = (await p.call('me')).packs[0]!
  const response = await s.request('POST', '/v1/packs/open', { client: version, token: p.token, body: { packId: pack.id } })
  assert.equal(response.status, 200)
  const body = await response.json() as OpenPackResponse
  const parsed = reader.parseResponse('openPack', body) as OpenPackResponse
  assert.equal(body.cards.length, 2)
  assert.equal(parsed.cards.length, 2, 'the released reader keeps both cards')
  assert.deepEqual(parsed.cards.map(c => c.id), body.cards.map(c => c.id))
  const after = (await p.call('cards')).cards
  assert.equal(after.length, before.length + 2)
  for (const card of before) assert.deepEqual(after.find(c => c.id === card.id), card)
  for (const card of body.cards) assert.deepEqual(after.find(c => c.id === card.id), card)
  assert.ok(!(await p.call('me')).packs.some(k => k.id === pack.id))
  assert.equal((await p.fails('openPack', { packId: pack.id })).code, 'not_found')
  assert.equal((await p.call('cards')).cards.length, after.length, 'a repeated opening mints nothing')
})

it('the current reader keeps all five cards from a released server answer', () => {
  const flow = JSON.parse(readFileSync(new URL('0.1.0/collection.json', fixtures), 'utf8')) as Flow
  const opened = flow.steps.find((step): step is Exchange => 'op' in step && step.op === 'openPack' && step.response.status === 200)!
  const recorded = opened.response.body as OpenPackResponse
  assert.equal(recorded.cards.length, 5, 'the historical server answer remains unchanged')
  // The recorder replaces real IDs with <card:n> placeholders; restore valid wire IDs only in this test input.
  const body = { cards: recorded.cards.map((card, i) => ({ ...card, id: `historical-card-${i}` })) }
  const parsed = parseResponse('openPack', body)
  assert.equal(parsed.cards.length, 5)
  assert.deepEqual(parsed.cards.map(c => c.id), body.cards.map(c => c.id))
})

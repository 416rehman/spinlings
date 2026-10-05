import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { JoinResponse, MeResponse } from '../../plugin/hooks/core/api.ts'
import { craftCost } from '../../plugin/hooks/core/cards.ts'
import { proofBits } from '../../plugin/hooks/core/sha256.ts'
import { card, NOW, speciesOf } from '../core/helpers.ts'
import * as frozen from './fixtures/0.1.0/schemas.ts'
import { bindAnswer, choosePackCards, preparePackCards, world } from './harness.ts'
import type { Reader, World } from './harness.ts'

const fresh = (id: string) => card(speciesOf('fable'), { id })

it('shorter, reordered collection answers preserve action identities and never position-bind omitted pack cards', () => {
  const bound = new Map<string, string>()
  const omitted = new Set(['<card:3>', '<card:4>', '<card:5>'])
  bindAnswer({ cards: [1, 2, 3, 4, 5].map(n => ({ id: `<card:${n}>` })) },
    { cards: [{ id: 'first' }, { id: 'last' }] }, bound, omitted)
  bound.set('<card:6>', 'starter')
  bindAnswer({ cards: [{ id: '<card:3>' }, { id: '<card:2>' }, { id: '<card:1>' }, { id: '<card:6>' }] },
    { cards: [{ id: 'starter' }, { id: 'first' }, { id: 'last' }] }, bound, omitted)
  assert.deepEqual([...bound], [['<card:1>', 'first'], ['<card:2>', 'last'], ['<card:6>', 'starter']])
  // A new list item also cannot alias an entity that an earlier action already named.
  bindAnswer([{ id: '<card:7>' }], [{ id: 'first' }], bound, omitted)
  assert.ok(!bound.has('<card:7>'))
})

it('omitted pack cards select distinct observed free cards while preserving every referenced action identity', () => {
  const omitted = new Map([['<card:3>', fresh('<card:3>')], ['<card:4>', fresh('<card:4>')]])
  const bound = new Map([['<card:1>', 'original'], ['<card:2>', 'unused-in-this-flow']])
  const referenced = new Set(['<card:1>', '<card:3>', '<card:4>'])
  const chosen = choosePackCards({ refs: ['<card:3>', '<card:4>'], omitted,
    cards: [fresh('original'), fresh('unused-in-this-flow'), fresh('second-free')], team: [], now: NOW, bound, referenced })
  assert.equal(chosen.size, 2)
  assert.equal(new Set(chosen.values()).size, 2, 'two fusion or trade inputs remain different cards')
  assert.deepEqual(new Set(chosen.values()), new Set(['unused-in-this-flow', 'second-free']))
  assert.deepEqual([...bound], [['<card:1>', 'original'], ['<card:2>', 'unused-in-this-flow']], 'selection does not mutate known bindings')
})

it('selection obeys the observed listing or Trader requirements rather than the historical card preference', () => {
  const historical = fresh('<card:3>')
  const eligible = card(speciesOf('opus'), { id: 'eligible', rarity: 'rare', shiny: true, foil: true, firstFind: true })
  const chosen = choosePackCards({ refs: ['<card:3>'], omitted: new Map([['<card:3>', historical]]),
    cards: [historical, { ...eligible, id: 'wrong-species', species: 's1-opus-1' },
      { ...eligible, id: 'wrong-rarity', rarity: 'common' }, { ...eligible, id: 'not-shiny', shiny: false },
      { ...eligible, id: 'not-foil', foil: undefined }, { ...eligible, id: 'not-first', firstFind: undefined }, eligible],
    team: [], now: NOW, bound: new Map(), referenced: new Set(['<card:3>']),
    requirement: { species: eligible.species, family: 'opus', rarity: 'rare', shiny: true, foil: true, firstFind: true } })
  assert.equal(chosen.get('<card:3>'), 'eligible')
})

it('selection fails explicitly instead of manufacturing, consuming unavailable cards or reusing another input', () => {
  const omitted = new Map([['<card:3>', fresh('<card:3>')], ['<card:4>', fresh('<card:4>')]])
  const bound = new Map([['<card:1>', 'reserved']])
  const base = { refs: ['<card:3>'], omitted, team: ['team-card'], now: NOW, bound, referenced: new Set(['<card:1>', '<card:3>', '<card:4>']) }
  const unavailable = [fresh('reserved'), fresh('team-card'), { ...fresh('bound'), bound: true },
    { ...fresh('held'), state: 'escrow' as const }, { ...fresh('locked'), lockedUntil: NOW + 1 },
    { ...fresh('tired'), tiredUntil: NOW + 1 }]
  assert.throws(() => choosePackCards({ ...base, cards: unavailable }), /no observed free card/)
  assert.throws(() => choosePackCards({ ...base, refs: ['<card:3>', '<card:4>'], cards: [fresh('only-one')] }), /no observed free card/)
  assert.throws(() => choosePackCards({ ...base, refs: ['<card:99>'], cards: [fresh('free')] }), /was not omitted/)
  assert.deepEqual([...bound], [['<card:1>', 'reserved']], 'failed selections leave every existing binding intact')
})

it('Market accepts a higher-rarity payment while the Trader keeps its exact-rarity requirement', () => {
  const o = { refs: ['<card:3>'], omitted: new Map([['<card:3>', fresh('<card:3>')]]),
    cards: [card(speciesOf('opus'), { id: 'higher-rarity', rarity: 'epic' })], team: [], now: NOW,
    bound: new Map<string, string>(), referenced: new Set(['<card:3>']), requirement: { family: 'opus' as const, rarity: 'rare' as const } }
  assert.equal(choosePackCards({ ...o, market: true }).get('<card:3>'), 'higher-rarity')
  assert.throws(() => choosePackCards(o), /no observed free card/)
})

it('an omitted card retains the foil and First Discovered fields later historical answers require', () => {
  const historical = { ...fresh('<card:3>'), foil: true as const, firstFind: true as const }
  const o = { refs: ['<card:3>'], omitted: new Map([['<card:3>', historical]]),
    team: [], now: NOW, bound: new Map<string, string>(), referenced: new Set(['<card:3>']) }
  const foil = { ...fresh('foil'), foil: true as const }
  const first = { ...fresh('first'), firstFind: true as const }
  assert.throws(() => choosePackCards({ ...o, cards: [foil, first] }), /no observed free card/)
  assert.equal(choosePackCards({ ...o, cards: [foil, first, { ...historical, id: 'both' }] }).get('<card:3>'), 'both')
})

const reader: Reader = frozen
async function joined(w: World): Promise<{ headers: Record<string, string>; me: MeResponse }> {
  const headers = { 'content-type': 'application/json', 'x-spinlings-client': '0.1.0' }
  const challenge = reader.parseResponse('challenge', JSON.parse((await w.send('a', 'GET', '/v1/challenge', headers)).text)) as { challenge: string; difficulty: number }
  let nonce = 0
  while (proofBits(challenge.challenge, nonce.toString(36)) < challenge.difficulty) nonce++
  const answer = await w.send('a', 'POST', '/v1/join', headers, JSON.stringify({ challenge: challenge.challenge, nonce: nonce.toString(36), family: 'haiku' }))
  assert.equal(answer.status, 200)
  const join = reader.parseResponse('join', JSON.parse(answer.text)) as JoinResponse
  return { headers: { ...headers, authorization: `Bearer ${join.token}` }, me: join.me }
}

it('supplemental selection buys only real API cards with existing sparks, rereads ownership and keeps starters and identities', async () => {
  const w = world('paid-selection')
  try {
    const { headers, me } = await joined(w)
    const omitted = new Map([['<card:3>', fresh('<card:3>')], ['<card:4>', fresh('<card:4>')]])
    const bound = new Map([['<card:1>', me.player.team[0]!]])
    const sent: string[] = [], read: string[] = []
    const chosen = await preparePackCards({ refs: [...omitted.keys()], omitted, team: me.player.team, now: w.now(), bound,
      referenced: new Set(['<card:1>', ...omitted.keys()]), player: 'a', headers,
      requirement: { rarity: 'common' },
      world: { send: async (...args) => { sent.push(`${args[1]} ${args[2]}`); return w.send(...args) } },
      reader: { ...reader, parseResponse: (op, body) => { read.push(op); return reader.parseResponse(op, body) } } })
    assert.equal(chosen.size, 2)
    assert.equal(new Set(chosen.values()).size, 2)
    assert.deepEqual([...bound], [['<card:1>', me.player.team[0]!]], 'bookkeeping never commits a partial binding')
    assert.deepEqual(sent.filter(s => s.startsWith('POST')), ['POST /v1/craft', 'POST /v1/craft'])
    assert.deepEqual(read, ['cards', 'me', 'season', 'craft', 'craft', 'cards'], 'every supplemental answer passes the frozen reader')
    const after = reader.parseResponse('me', JSON.parse((await w.send('a', 'GET', '/v1/me', headers)).text)) as MeResponse
    assert.equal(after.player.sparks, me.player.sparks - 2 * craftCost('common'))
    assert.deepEqual(after.player.team, me.player.team)
    const cards = JSON.parse((await w.send('a', 'GET', '/v1/cards', headers)).text).cards
    for (const id of chosen.values()) assert.ok(cards.some((c: { id: string; origin: string; bound: boolean }) => c.id === id && c.origin === 'craft' && !c.bound))
  } finally { w.close() }
})

it('supplemental selection fails within actual funds and never funds or fabricates a missing third card', async () => {
  const w = world('insufficient-selection')
  try {
    const { headers, me } = await joined(w)
    const omitted = new Map([3, 4, 5].map(n => [`<card:${n}>`, fresh(`<card:${n}>`)] as const))
    const bound = new Map<string, string>()
    await assert.rejects(preparePackCards({ refs: [...omitted.keys()], omitted, team: me.player.team, now: w.now(), bound,
      referenced: new Set(omitted.keys()), player: 'a', headers, reader, world: w, requirement: { rarity: 'common' } }), /cannot afford/)
    assert.equal(bound.size, 0)
    const after = reader.parseResponse('me', JSON.parse((await w.send('a', 'GET', '/v1/me', headers)).text)) as MeResponse
    assert.equal(after.player.sparks, me.player.sparks % craftCost('common'))
    const cards = JSON.parse((await w.send('a', 'GET', '/v1/cards', headers)).text).cards
    assert.equal(cards.filter((c: { bound: boolean }) => !c.bound).length, Math.floor(me.player.sparks / craftCost('common')))
  } finally { w.close() }
})

it('an exact Trader rarity is acquired through paid packs without opening any historically named pack', async () => {
  const w = world('rare-selection')
  try {
    const { headers, me } = await joined(w)
    // This is the same explicit funded precondition in the immutable collection fixtures, not a replay shortcut.
    await w.setup({ setup: 'trust', player: 'a', at: w.now() })
    const before = reader.parseResponse('me', JSON.parse((await w.send('a', 'GET', '/v1/me', headers)).text)) as MeResponse
    const bodies: { path: string; body: unknown }[] = []
    const chosen = await preparePackCards({ refs: ['<card:3>'], omitted: new Map([['<card:3>', fresh('<card:3>')]]),
      team: me.player.team, now: w.now(), bound: new Map(), referenced: new Set(['<card:3>']), player: 'a', headers, reader,
      requirement: { family: 'opus', rarity: 'rare' },
      world: { send: async (...args) => {
        if (args[1] === 'POST') bodies.push({ path: args[2], body: JSON.parse(args[4]!) })
        return w.send(...args)
      } } })
    const cards = JSON.parse((await w.send('a', 'GET', '/v1/cards', headers)).text).cards
    const selected = cards.find((c: { id: string }) => c.id === chosen.get('<card:3>'))
    assert.equal(selected.family, 'opus')
    assert.equal(selected.rarity, 'rare')
    assert.equal(selected.origin, 'pack')
    const buys = bodies.filter(b => b.path === '/v1/packs/buy'), opens = bodies.filter(b => b.path === '/v1/packs/open')
    assert.ok(buys.length > 0 && buys.length <= 32)
    assert.equal(opens.length, buys.length)
    for (const open of opens) assert.ok(!before.packs.some(p => p.id === (open.body as { packId: string }).packId))
    const after = reader.parseResponse('me', JSON.parse((await w.send('a', 'GET', '/v1/me', headers)).text)) as MeResponse
    assert.deepEqual(after.packs.map(p => p.id), before.packs.map(p => p.id))
    assert.equal(after.player.sparks, before.player.sparks - buys.length * 150)
  } finally { w.close() }
})

it('a failed supplemental frozen reader stops before any paid acquisition', async () => {
  const w = world('reader-selection')
  try {
    const { headers, me } = await joined(w)
    const sent: string[] = []
    await assert.rejects(preparePackCards({ refs: ['<card:3>'], omitted: new Map([['<card:3>', fresh('<card:3>')]]),
      team: me.player.team, now: w.now(), bound: new Map(), referenced: new Set(['<card:3>']), player: 'a', headers,
      reader: { ...reader, parseResponse: () => { throw new Error('frozen reader rejects it') } },
      world: { send: async (...args) => { sent.push(args[1]); return w.send(...args) } } }), /frozen reader rejects/)
    assert.deepEqual(sent, ['GET'])
  } finally { w.close() }
})

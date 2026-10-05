// A confirmed server choice is an online switch; naming/cancelling it is local, and every save stays at its origin.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { openSave } from '../../plugin/hooks/client/local/save.ts'
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { NOW, ORIGIN, TOKEN, fakeServer } from './fixtures.ts'
import { BAND, RUN, SESSION, engine, settle } from './engine.ts'

const COMMUNITY = 'https://cards.example.org'
const COMMUNITY_TOKEN = 'tok_' + 'c'.repeat(40)

function twoServers(on: On) {
  const normal = fakeServer(), community = fakeServer()
  community.cards = community.cards.map(c => ({ ...c, id: `community-${c.id}` }))
  community.me = { ...community.me, player: { ...community.me.player, handle: 'mossy-badger-9', team: community.me.player.team.map(id => `community-${id}`) } }
  // Distinct sessions and cards catch a server switch that reuses the other origin's credentials or cache.
  const w = engine(on, { ...normal, handle: (url, init = {}) => {
    const at = new URL(url)
    if (at.origin === ORIGIN) return normal.handle(url, init)
    if (at.origin !== COMMUNITY) throw new Error('unexpected server')
    const authorization = init.headers?.authorization
    if (authorization && authorization !== `Bearer ${COMMUNITY_TOKEN}`) throw new Error('wrong origin session')
    const answer = community.handle(ORIGIN + at.pathname + at.search, {
      ...init, headers: { ...init.headers, ...(authorization ? { authorization: `Bearer ${TOKEN}` } : {}) },
    })
    if (at.pathname === '/v1/join') return { ...answer, text: JSON.stringify({ ...JSON.parse(answer.text), token: COMMUNITY_TOKEN }) }
    return answer
  } })
  return { w, normal, community }
}

test('offline Connect joins online after confirmation; Cancel keeps the offline world and sends nothing', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), { w, community } = twoServers(on)
  w.store.set('prefs', { world: 'offline' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  const saved = JSON.stringify(w.store.get('offline:v1'))
  const prefs = JSON.stringify(w.store.get('prefs'))
  const local = openSave(w.store.get('offline:v1'))
  if (local.kind !== 'ok') throw new Error('offline save did not open')
  const values = [...local.state.cards.flatMap(c => [c.id, cardName(c)]), ...local.state.packs.map(p => p.id)]
  const ui = await $.ui.mount(BAND(24, 'desktop'))
  await $.command.run(RUN(`server ${COMMUNITY}/nested/path`))
  await settle(clock)
  await ui.redraw()
  expect((await ui.find({ key: `act-server:${COMMUNITY}` }))?.props.label).toBe('Connect')
  expect(w.requests).toEqual([])
  await ui.press({ key: `dismiss-server:${COMMUNITY}` })
  await settle(clock)
  expect(w.requests).toEqual([])
  expect(JSON.stringify(w.store.get('prefs'))).toBe(prefs)
  expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)
  await $.command.run(RUN(`server ${COMMUNITY}`))
  await settle(clock)
  await ui.redraw()
  const mark = w.reads.length
  await ui.press({ key: `act-server:${COMMUNITY}` })
  await settle(clock, 12)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY, communityOk: [COMMUNITY] })
  expect(w.status.at(-1)).toBe('▪')
  expect(w.requests.length).toBeGreaterThan(2)
  expect(w.requests[0]!.url).toBe(`${COMMUNITY}/v1/version`)
  expect(w.requests.every(r => r.url.startsWith(`${COMMUNITY}/v1/`))).toBe(true)
  expect(w.reads.slice(mark).filter(k => k.startsWith('offline:'))).toEqual([])
  for (const r of w.requests) for (const value of values) expect(`${r.url}\n${JSON.stringify(r.headers)}\n${r.body}`).not.toContain(value)
  expect(w.store.get(`server:${COMMUNITY}:session`)).toBe(COMMUNITY_TOKEN)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  expect(w.store.get(`server:${COMMUNITY}:cache`)).toMatchObject({ me: { player: { handle: community.me.player.handle } }, cards: { cards: community.cards } })
  expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)
  await ui.unmount()
})

test('explicit default and approved server choices resume their own accounts from offline without new joins', { timeoutMs: 90_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), { w, normal, community } = twoServers(on)
  w.store.set('prefs', { world: 'offline', server: COMMUNITY, communityOk: [COMMUNITY] })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  w.store.set(`server:${COMMUNITY}:session`, COMMUNITY_TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  const saved = JSON.stringify(w.store.get('offline:v1'))
  expect(w.requests).toEqual([])
  await $.command.run(RUN('server default'))
  await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: ORIGIN })
  expect(w.store.get(`server:${ORIGIN}:cache`)).toMatchObject({ me: { player: { handle: normal.me.player.handle } }, cards: { cards: normal.cards } })
  const normalCache = JSON.stringify(w.store.get(`server:${ORIGIN}:cache`))
  await $.command.run(RUN('world offline'))
  await settle(clock)
  const mark = w.requests.length
  // Already approved means the command itself is the explicit Connect, including when this was the saved offline target.
  await $.command.run(RUN(`server ${COMMUNITY}`))
  await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: COMMUNITY })
  expect(w.requests.slice(mark).every(r => r.url.startsWith(`${COMMUNITY}/v1/`))).toBe(true)
  expect(w.store.get(`server:${COMMUNITY}:cache`)).toMatchObject({ me: { player: { handle: community.me.player.handle } }, cards: { cards: community.cards } })
  await $.command.run(RUN('server default'))
  await settle(clock)
  expect(w.store.get('prefs')).toMatchObject({ world: 'online', server: ORIGIN })
  expect(JSON.stringify(w.store.get(`server:${ORIGIN}:cache`))).toBe(normalCache)
  expect(w.requests.filter(r => r.url.endsWith('/v1/join'))).toEqual([])
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  expect(w.store.get(`server:${COMMUNITY}:session`)).toBe(COMMUNITY_TOKEN)
  expect(JSON.stringify(w.store.get('offline:v1'))).toBe(saved)
})

test('naming and cancelling an unapproved server online never asks it or changes the active account', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), { w } = twoServers(on)
  w.store.set('prefs', { world: 'online' })
  w.store.set(`server:${ORIGIN}:session`, TOKEN)
  await $.session.start(SESSION)
  await settle(clock)
  const cache = JSON.stringify(w.store.get(`server:${ORIGIN}:cache`)), mark = w.requests.length
  const prefs = JSON.stringify(w.store.get('prefs'))
  const ui = await $.ui.mount(BAND(24, 'terminal'))
  await $.command.run(RUN(`server ${COMMUNITY}`))
  await settle(clock)
  await ui.redraw()
  expect((await ui.find({ key: `act-server:${COMMUNITY}` }))?.props.label).toBe('Connect')
  await ui.press({ key: `dismiss-server:${COMMUNITY}` })
  await settle(clock)
  expect(w.requests.slice(mark)).toEqual([])
  expect(JSON.stringify(w.store.get('prefs'))).toBe(prefs)
  expect(JSON.stringify(w.store.get(`server:${ORIGIN}:cache`))).toBe(cache)
  expect(w.store.has(`server:${COMMUNITY}:session`)).toBe(false)
  await ui.unmount()
})

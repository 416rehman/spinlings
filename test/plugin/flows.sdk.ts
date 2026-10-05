// The wired mod, end to end through the engine: every /spin subcommand answers {} and does what it says (SPEC 9),
// both passkey flows show the page on the server's own origin and then poll (29, 30), chimes play only when sound is
// on and never while quiet (13.12), a newer mod is announced once in the band (32), and the spinner names the
// opponent during a battle (10). A battle is finished at a moment the effort setting has no say in (20.2), a sign-in
// under way stops polling once play moves to another world or server (28, 29, 33), and on the desktop, where a copy
// cannot reach the clipboard yet, the text to copy shows instead (35).
import { expect, mock, test } from 'claude-code/testing'
import { NEXT, NOW, ORIGIN, OTHER_TOKEN, TOKEN, fakeServer } from './fixtures.ts'
import { BAND, PANE, RUN, SESSION, engine, settle, textOf, walk } from './engine.ts'
import type { Engine } from './engine.ts'
import type { Card } from '../../plugin/hooks/core/types.ts'
import { parseResponse } from '../../plugin/hooks/core/schemas.ts'
import { chimeClip } from '../../plugin/hooks/client/chimes.ts'

const LONG = { timeoutMs: 120_000 }

const sent = (w: Engine) => w.requests.map(r => `${r.method} ${new URL(r.url).pathname}`)
const bodyOf = (w: Engine, what: string) => JSON.parse(w.requests.findLast(r => `${r.method} ${new URL(r.url).pathname}` === what)?.body || 'null') as unknown

test('every /spin subcommand answers {} and does what it says', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const run = async (args: string) => {
    expect({ args, answer: await $.command.run(RUN(args)) }).toEqual({ args, answer: {} })
    await settle(clock)
  }
  await run('')
  expect(w.opened).toBe(1)
  await run('help')
  expect(w.logs.at(-1)).toMatch(/\/spin leaderboard \[on\|off\][\s\S]*\/spin handle \[new\]/)
  expect(w.logs.at(-1)).not.toContain('/spin demo')
  await run('pack')
  expect(sent(w)).not.toContain('POST /v1/packs/open')
  const preview = await $.ui.mount(BAND(80))
  expect((await preview.find({ key: 'inline-pack-open' }))?.props.label).toBe('Open')
  await preview.press({ key: 'inline-pack-open' })
  await settle(clock)
  expect(sent(w).filter(x => x === 'POST /v1/packs/open')).toHaveLength(1)
  await preview.redraw()
  await preview.press({ key: 'inline-pack-close' })
  await settle(clock)
  await preview.unmount()
  await run('team starter-0 starter-1 shiny-foil')
  expect(bodyOf(w, 'PUT /v1/team')).toEqual({ cardIds: ['starter-0', 'starter-1', 'shiny-foil'] })
  expect(w.logs.at(-1)).toBe('Team set.')
  await run('trade quiet-otter-42')
  expect(sent(w)).toContain('GET /v1/players/quiet-otter-42')
  const before = w.requests.length
  await run('gift shiny-foil')
  expect(w.requests.length).toBe(before)
  await run('claim quiet-otter-lamp-4821')
  expect(bodyOf(w, 'POST /v1/claim')).toEqual({ code: 'quiet-otter-lamp-4821' })
  await run('redeem FOUNDERS')
  expect(bodyOf(w, 'POST /v1/redeem')).toEqual({ code: 'FOUNDERS' })
  await run('share shiny-foil')
  expect(w.copied.at(-1)).toContain(`${ORIGIN}/c/shiny-foil`)
  await run('devices')
  expect(sent(w)).toContain('GET /v1/me/devices')
  await run('privacy')
  await run('leaderboard')
  expect(w.requests.some(r => r.method === 'GET' && r.url === `${ORIGIN}/v1/leaderboards?board=rating&period=all`)).toBe(true)
  await run('leaderboard on')
  expect(bodyOf(w, 'PUT /v1/me/leaderboard')).toEqual({ optIn: true })
  expect(w.logs.at(-1)).toMatch(/You are on the boards/)
  await run('handle')
  expect(w.logs.at(-1)).toMatch(/^You are brave-wren-41/)
  await run('handle new')
  expect(sent(w)).toContain('POST /v1/me/handle')
  expect(w.logs.at(-1)).toBe('You are now quiet-fern-07.')
  await run('motion off')
  expect((w.store.get('prefs') as { motion: boolean }).motion).toBe(false)
  await run('sound on')
  expect((w.store.get('prefs') as { sound: boolean }).sound).toBe(true)
  await run('quiet on')
  expect(w.status.at(-1)).toBeUndefined()
  await run('quiet off')
  expect(w.status.at(-1)).toMatch(/^Online/)
  await run('server')
  expect(w.logs.at(-1)).toBe('Server: spinlings.dev')
  const worldRequests = w.requests.length, worldPrefs = JSON.stringify(w.store.get('prefs'))
  await run('world')
  const chooser = await $.ui.mount(PANE(24))
  expect(textOf(await chooser.drawn())).toContain('Choose a world')
  expect(await chooser.find({ key: 'world-offline' })).toBeDefined()
  expect(await chooser.find({ key: 'world-address' })).toBeDefined()
  expect(w.requests.length).toBe(worldRequests)
  expect(JSON.stringify(w.store.get('prefs'))).toBe(worldPrefs)
  await chooser.unmount()
  const beforeDebug = { requests: w.requests.length, opened: w.opened, prefs: JSON.stringify(w.store.get('prefs')) }
  await run('demo')
  expect(w.logs.at(-1)).toMatch(/^There is no \/spin demo\./)
  expect(w.logs.at(-1)).not.toMatch(/\/spin demo\s+every screen/)
  expect({ requests: w.requests.length, opened: w.opened, prefs: JSON.stringify(w.store.get('prefs')) }).toEqual(beforeDebug)
  await run('battle')
  expect(bodyOf(w, 'POST /v1/battles')).toEqual({ kind: 'duel', family: 'opus' })
  // nothing a command did ever carried the token anywhere but the header
  expect(w.requests.every(r => !r.body.includes(TOKEN) && !r.url.includes(TOKEN))).toBe(true)
})

test('adding a passkey: the page shows on the server\'s own origin, then the poll sees it saved', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('devices'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'passkey-add' })
  await settle(clock)
  expect(sent(w)).toContain('POST /v1/me/passkey/start')
  await ui.redraw()
  const link = walk(await ui.drawn()).find(n => n.type === 'Link')
  expect(link?.props?.href).toBe(`${ORIGIN}/passkey/add?t=ticket-1`)
  expect(textOf(await ui.drawn())).toMatch(/The page works for 10 min more/)
  w.server.poll = 'added'
  await clock.advance(2000)
  await settle(clock)
  expect(sent(w)).toContain('GET /v1/auth/poll/poll-add')
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/✓ Saved: your collection is backed up/)
  expect((w.store.get(`server:${ORIGIN}:meta`) as { passkeyDay: string }).passkeyDay).toBe('saved')
  await ui.unmount()
})

test('signing in with a passkey: this computer plays as that account from the poll on', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('devices'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80, 'desktop'))
  await ui.press({ key: 'passkey-signin' })
  await settle(clock)
  expect(sent(w)).toContain('POST /v1/auth/start')
  await ui.redraw()
  expect(walk(await ui.drawn()).find(n => n.type === 'Link')?.props?.href).toBe(`${ORIGIN}/passkey/signin?p=poll-signin`)
  // the page has not been used yet: the poll keeps waiting, every 2 s
  await clock.advance(2000)
  await settle(clock)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  w.server.poll = 'done'
  await clock.advance(2000)
  await settle(clock)
  expect(sent(w).filter(x => x === 'GET /v1/auth/poll/poll-signin').length).toBe(2)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(OTHER_TOKEN)
  await ui.unmount()
  await $.command.run(RUN('handle'))
  expect(w.logs.at(-1)).toMatch(/^You are misty-lark-18/)
  // the poll never carries the token, and no URL ever does
  expect(w.requests.filter(r => r.url.includes('/auth/poll/')).every(r => r.headers.authorization === undefined)).toBe(true)
})

test('chimes play only with sound on, for rare and better, and never while quiet', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const server = fakeServer(), handle = server.handle.bind(server)
  // Rarity is explicit test data: packs no longer promise any rarity. Cover a rare card with sound off,
  // then common and rare cards with sound on, and a real rare redeem while quiet.
  server.me = { ...server.me, packs: [...server.me.packs, { ...server.me.packs[0]!, id: 'pack-chime-rare' }] }
  server.handle = (url, init) => {
    const answer = handle(url, init)
    if (answer.ok && (url.endsWith('/v1/packs/open') || url.endsWith('/v1/redeem'))) {
      const parsed = JSON.parse(answer.text) as { cards: Card[] }
      const common = url.endsWith('/v1/packs/open') && JSON.parse(init?.body ?? '{}').packId === 'pack-welcome-2'
      parsed.cards = parsed.cards.map(({ firstFind: _first, ...c }) => ({ ...c, rarity: common ? 'common' : 'rare' }))
      parseResponse(url.endsWith('/v1/packs/open') ? 'openPack' : 'redeem', parsed)
      server.cards = server.cards.map(c => parsed.cards.find(got => got.id === c.id) ?? c)
      return { ...answer, text: JSON.stringify(parsed) }
    }
    return answer
  }
  const w = engine(on, server)
  await $.session.start(SESSION)
  await settle(clock)
  const openAll = async () => {
    await $.command.run(RUN('pack'))
    await settle(clock)
    const preview = await $.ui.mount(BAND(80))
    expect((await preview.find({ key: 'inline-pack-open' }))?.props.label).toBe('Open')
    await preview.press({ key: 'inline-pack-open' })
    await settle(clock)
    await preview.redraw()
    expect({ label: (await preview.find({ key: 'inline-pack-open' }))?.props.label, text: textOf(await preview.drawn()) })
      .toMatchObject({ label: 'Flip next' })
    await preview.press({ key: 'inline-pack-open' })
    await settle(clock)
    for (let i = 0; i < 40; i++) await clock.advance(1000)
    await settle(clock)
    await preview.redraw()
    await preview.press({ key: 'inline-pack-close' })
    await settle(clock)
    await preview.unmount()
  }
  await openAll()
  expect(w.sounds).toEqual([])
  await $.command.run(RUN('sound on'))
  await openAll()
  expect(w.sounds).toEqual([])
  await openAll()
  expect(w.sounds.length).toBeGreaterThan(0)
  expect(w.sounds.every(s => s === chimeClip('rare').base64)).toBe(true)
  const heard = w.sounds.length
  await $.command.run(RUN('quiet on'))
  const cards = w.server.cards.length
  await $.command.run(RUN('redeem FOUNDERS'))
  for (let i = 0; i < 20; i++) await clock.advance(1000)
  await settle(clock)
  expect(w.server.cards).toHaveLength(cards + 1)
  expect(w.server.cards.at(-1)?.rarity).toBe('rare')
  expect(w.sounds.length).toBe(heard)
})

test('an opened inline pack flips automatically on both surfaces without a mounted sidebar or another press', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW }), w = engine(on)
  let flipped = 0
  // Observe the real host atom writes; preserve its state/CAS behavior instead of supplying a fake state table.
  on('state.set', (_$, e, next) => {
    if (e.key === 'pane') flipped = (e.value as { flipped: number }).flipped
    return next(e)
  })
  await $.session.start(SESSION)
  await settle(clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(RUN('pack'))
    await settle(clock)
    const ui = await $.ui.mount(BAND(80, surface))
    expect((await ui.find({ key: 'inline-pack-open' }))?.props.label).toBe('Open')
    expect(flipped).toBe(0)
    await ui.press({ key: 'inline-pack-open' })
    await settle(clock)
    // Flush timer callbacks and their asynchronous state reads between clock steps, as the real clock does.
    for (let i = 0; i < 150 && flipped < 1; i++) {
      await clock.advance(100)
      await settle(clock)
    }
    expect(flipped).toBe(1)
    await ui.redraw()
    expect(await ui.find({ text: '1 card added to Collection' })).toBeDefined()
    expect(await ui.find({ key: 'inline-pack-open' })).toBeUndefined()
    expect(w.opened).toBe(0)
    await ui.press({ key: 'inline-pack-close' })
    await settle(clock)
    await ui.unmount()
  }
  expect(w.requests.filter(r => r.url.endsWith('/v1/packs/open'))).toHaveLength(2)
})

test('a newer mod is announced in the band once, and stays gone once acknowledged', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, fakeServer({ latestClient: NEXT }))
  await $.session.start(SESSION)
  await settle(clock)
  let band = await $.ui.mount(BAND(80))
  await band.press({ key: 'dismiss-welcome' })
  await settle(clock)
  await band.redraw()
  expect(textOf(await band.drawn())).toContain(`Spinlings ${NEXT} is out`)
  expect(textOf(await band.drawn())).toMatch(/claude plugin update spinlings@spinlings/)
  await band.press({ key: `act-update:${NEXT}` })
  await settle(clock)
  await band.unmount()
  await $.session.start(SESSION)
  await settle(clock)
  band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).not.toMatch(/is out/)
  await band.unmount()
})

test('a trade accepted while away arrives as a wrapped present that opens on the card it brought', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  let band = await $.ui.mount(BAND(80))
  await band.press({ key: 'dismiss-welcome' })
  await band.unmount()
  // the other player accepts: a notice, and their card in this collection
  const got = { ...w.server.cards[0]!, id: 'traded-1', bound: false, origin: 'pack' as const }
  w.server.cards = [...w.server.cards, got]
  w.server.me = {
    ...w.server.me, player: { ...w.server.me.player, cardsVersion: w.server.me.player.cardsVersion + 1 },
    notices: [{ id: 'n-accept', day: '2026-10-02', kind: 'offer-accepted', text: 'soft-otter-42 accepted your offer', handle: 'soft-otter-42' }],
  }
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).toMatch(/soft-otter-42 sent you a gift!/)
  await band.press({ key: 'act-present:n-accept' })
  await settle(clock)
  await band.unmount()
  const pane = await $.ui.mount(PANE(80))
  expect(textOf(await pane.drawn())).toMatch(/wrapped up for you/)
  await pane.press({ key: 'flip' })
  await settle(clock)
  await pane.redraw()
  expect(walk(await pane.drawn()).some(n => n.type === 'Raster')).toBe(true)
  await pane.unmount()
})

test('during a battle the spinner names the opponent; between battles it is left alone', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const suffixes: string[] = []
  on('ui.render', { component: 'Spinner' }, (_$, e) => { suffixes.push(String(e.props.suffix)); return { type: 'Text', props: {}, children: ['spinner'] } })
  engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const spinner = { plugin: 'spinlings', component: 'Spinner', requestId: 'main', surface: 'terminal', props: { word: 'Working', message: null, suffix: '…', mode: 'responding' } } as const
  let ui = await $.ui.mount(spinner)
  await ui.unmount()
  expect(suffixes.at(-1)).toBe('…')
  await $.command.run(RUN('battle'))
  await settle(clock)
  ui = await $.ui.mount(spinner)
  await ui.unmount()
  expect(suffixes.at(-1)).toBe('… · Rival Thistlewick')
})

test('a session the server no longer knows: the pane offers a fresh start, and starting fresh joins anew', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  w.store.set('prefs', { world: 'online', worldOption: 'online' })
  w.store.set(`server:${ORIGIN}:session`, 'tok_' + 'd'.repeat(40))
  await $.session.start(SESSION)
  await settle(clock)
  expect(sent(w)).toContain('GET /v1/me')
  expect(sent(w)).not.toContain('POST /v1/join')
  const ui = await $.ui.mount(PANE(80))
  expect(textOf(await ui.drawn())).toMatch(/This computer is signed out of spinlings\.dev/)
  expect((await ui.find({ key: 'start-fresh' }))?.props).toMatchObject({ hotkey: '1', variant: 'primary' })
  expect((await ui.find({ key: 'tab-team' }))?.props.hotkey).toBeUndefined()
  await ui.press({ key: 'start-fresh' })
  await settle(clock)
  expect(sent(w)).toContain('POST /v1/join')
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  await ui.redraw()
  expect(textOf(await ui.drawn())).not.toMatch(/signed out/)
  await ui.unmount()
  // and /spin world online is the same way out
  w.store.set(`server:${ORIGIN}:session`, 'tok_' + 'e'.repeat(40))
  await $.session.start(SESSION)
  await settle(clock)
  const joins = sent(w).filter(x => x === 'POST /v1/join').length
  await $.command.run(RUN('world online'))
  await settle(clock)
  expect(sent(w).filter(x => x === 'POST /v1/join').length).toBe(joins + 1)
})

test('a battle is finished at the same moment whatever the effort setting: the request\'s timing says nothing of it (SPEC 20.2)', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  const finishes = () => w.requests.filter(r => r.url.endsWith('/finish')).length
  const untilFinished = async (effort: string) => {
    const stream = $.turn.step({ turnId: `t-${effort}`, index: 0, model: 'claude-opus-5-5', effort, messageCount: 1 } as never)
    while (!(await stream.next()).done) { /* the step runs through */ }
    const before = finishes()
    await $.command.run(RUN('battle'))
    let ms = 0
    for (; ms < 180_000 && finishes() === before; ms += 250) await clock.advance(250)
    // the result and its ceremonies, then a quiet band for the next one
    for (let i = 0; i < 40; i++) await clock.advance(1000)
    await settle(clock)
    return ms
  }
  const low = await untilFinished('low')
  const max = await untilFinished('max')
  expect(low).toBeGreaterThan(0)
  expect(low).toBeLessThan(180_000)
  expect(max).toBe(low)
})

test('a passkey sign-in under way stops when play moves: no poll goes out offline or to another server, and nothing it brings lands', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  const COMMUNITY = 'https://cards.example.org'
  // the community server was agreed to before: /spin server moves at once
  w.store.set('prefs', { communityOk: [COMMUNITY] })
  await $.session.start(SESSION)
  await settle(clock)
  const polls = () => w.requests.filter(r => r.url.includes('/v1/auth/poll/'))
  const signIn = async () => {
    await $.command.run(RUN('devices'))
    await settle(clock)
    const ui = await $.ui.mount(PANE(80))
    await ui.press({ key: 'passkey-signin' })
    await settle(clock)
    await ui.unmount()
    await clock.advance(2000)
    await settle(clock)
  }
  await signIn()
  expect(polls().length).toBe(1)
  await $.command.run(RUN('world offline'))
  await settle(clock)
  // the page is used now, too late: offline nothing is asked, so the session it would hand over never arrives
  w.server.poll = 'done'
  for (let i = 0; i < 10; i++) await clock.advance(2000)
  await settle(clock)
  expect(polls().length).toBe(1)
  expect(w.store.get(`server:${ORIGIN}:session`)).toBe(TOKEN)
  let pane = await $.ui.mount(PANE(80))
  expect(textOf(await pane.drawn())).not.toMatch(/The page works for|Signed in: this computer/)
  await pane.unmount()

  // online again, a new sign-in, then /spin server: its poll id goes to no other origin
  w.server.poll = 'pending'
  await $.command.run(RUN('world online'))
  await settle(clock)
  await signIn()
  const before = polls().length
  expect(polls().at(-1)?.url.startsWith(`${ORIGIN}/`)).toBe(true)
  await $.command.run(RUN(`server ${COMMUNITY}`))
  await settle(clock)
  for (let i = 0; i < 10; i++) await clock.advance(2000)
  await settle(clock)
  expect(polls().length).toBe(before)
  expect(w.requests.some(r => r.url.startsWith(COMMUNITY) && r.url.includes('/auth/poll/'))).toBe(false)
  pane = await $.ui.mount(PANE(80))
  expect(textOf(await pane.drawn())).not.toMatch(/The page works for/)
  await pane.unmount()
})

test('on the desktop, where a copy cannot reach the clipboard yet, a share shows its text to copy and never claims a copy', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  await $.command.run(RUN('gift shiny-foil'))
  await settle(clock)
  const desk = await $.ui.mount(PANE(80, 'desktop'))
  await desk.press({ key: 'share' })
  await settle(clock)
  await desk.redraw()
  let text = textOf(await desk.drawn())
  expect(w.copies.at(-1)?.surface).toBe('desktop')
  expect(w.copied).toEqual([])
  expect({ lead: /To share it, copy this:/.test(text), claims: /Copied/.test(text) }).toEqual({ lead: true, claims: false })
  expect(text).toContain(`${ORIGIN}/c/shiny-foil`)
  await desk.unmount()
  // the terminal's copy lands and says so, and the text to copy goes
  const term = await $.ui.mount(PANE(80))
  await term.press({ key: 'share' })
  await settle(clock)
  await term.redraw()
  text = textOf(await term.drawn())
  expect(w.copied.at(-1)).toContain(`${ORIGIN}/c/shiny-foil`)
  expect({ said: /Copied .+ to share\./.test(text), lead: /To share it, copy this:/.test(text) }).toEqual({ said: true, lead: false })
  await term.unmount()
})

test('a full pack bank is one world\'s word: it lifts once the world in play has room, and charging goes on', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  // left behind by another world, or by packs since opened on another computer
  w.store.set('presence', { minutes: 50, blocked: 'bank', blockedUntil: 0, lastMinute: 0, lease: null })
  await $.session.start(SESSION)
  await settle(clock)
  expect((w.store.get('presence') as { blocked: unknown }).blocked).toBeNull()
  await clock.advance(60_000)
  await settle(clock)
  expect(sent(w)).toContain('POST /v1/packs/charge')
})

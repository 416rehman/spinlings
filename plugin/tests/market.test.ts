// 0.2.0 end to end through the engine: the market (browse tiles that are buttons, one press to the confirm, Buy; sell
// from a card's page with a price that starts from recent sales; your listings), the leaderboards (boards, periods,
// your rank pinned, rows that open profiles with stat tiles), challenges by handle, a sale while away shown with its
// creature, the passkey offered at a moment worth keeping (once a day, a header marker until saved), the welcome that
// leaves once its pack is open, working time that adds up across turns, and the offline world, where none of it shows
// and nothing is sent (SPEC 8, 13, 28, 30, 34).
import { expect, mock, test } from 'claude-code/testing'
import { NOW, ORIGIN, fakeServer } from './fixtures.ts'
import { BAND, PANE, RUN, SESSION, cardArt, engine, settle, textOf, walk } from './engine.ts'
import { nameOf, pairMarketNotices, soldPrice } from '../hooks/client/game.ts'
import { toBattleCard } from '../hooks/core/cards.ts'
import type { ListingView, Notice } from '../hooks/core/api.ts'
import type { Engine } from './engine.ts'
import type { TestBody } from 'claude-code/testing'

const LONG = { timeoutMs: 120_000 }

const urls = (w: Engine) => w.requests.map(r => `${r.method} ${r.url.slice(ORIGIN.length)}`)
const bodyOf = (w: Engine, method: string, path: string) =>
  JSON.parse(w.requests.findLast(r => r.method === method && new URL(r.url).pathname === path)?.body || 'null') as unknown

/** Joins and puts the welcome away, so the band and the pane show what each test is about. */
async function started($: Parameters<TestBody>[0], clock: { settle(): Promise<void> }): Promise<void> {
  await $.session.start(SESSION)
  await settle(clock)
  const band = await $.ui.mount(BAND(80))
  await band.press({ key: 'dismiss-welcome' })
  await band.unmount()
}

test('the market: listings are tiles with art that are buttons, one press opens the confirm, Buy buys and the card arrives', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  await $.command.run(RUN('market'))
  await settle(clock)
  expect(urls(w)).toContain('GET /v1/market?sort=newest')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE(80), surface })
    expect((await ui.find({ key: 'tab-market' }))?.props.hotkey).toBe('4')
    expect((await ui.find({ key: 'tab-trade' }))?.props.hotkey).toBe('5')
    const tile = await ui.find({ key: 'listing-listing-for-sale-pick' })
    expect(tile?.type).toBe('Button')
    expect(cardArt(await ui.findAll({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).length).toBeGreaterThan(0)
    expect(textOf(await ui.drawn())).toMatch(/✧ 40/)
    await ui.unmount()
  }
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'listing-listing-for-sale-pick' })
  await settle(clock)
  await ui.redraw()
  const text = textOf(await ui.drawn())
  expect(text).toMatch(/You give/)
  expect(text).toMatch(/You get/)
  expect((await ui.find({ key: 'buy' }))?.props).toMatchObject({ label: 'Buy for ✧ 40', hotkey: '1', variant: 'primary' })
  expect((await ui.find({ key: 'challenge' }))?.props.hotkey).toBe('c')
  // a double press buys once, and never says someone else got it
  await Promise.all([ui.press({ key: 'buy' }), ui.press({ key: 'buy' })])
  await settle(clock)
  await ui.press({ key: 'buy' }).catch(() => undefined)
  await settle(clock)
  expect(urls(w).filter(u => u === 'POST /v1/market/listing-for-sale/buy').length).toBe(1)
  expect(bodyOf(w, 'POST', '/v1/market/listing-for-sale/buy')).toEqual({})
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/wrapped up for you/)
  expect(textOf(await ui.drawn())).not.toMatch(/Someone else got it first/)
  await ui.unmount()
})

test('the Market tab reads the market again when what shows is a few minutes old', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  const reads = () => urls(w).filter(u => u === 'GET /v1/market?sort=newest').length
  await $.command.run(RUN('market'))
  await settle(clock)
  expect(reads()).toBe(1)
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'tab-team' })
  await ui.press({ key: 'tab-market' })
  await settle(clock)
  expect(reads()).toBe(1)
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  await ui.press({ key: 'tab-team' })
  await ui.press({ key: 'tab-market' })
  await settle(clock)
  expect(reads()).toBe(2)
  await ui.unmount()
})

test('selling: Sell on a card page opens the price stepper from recent sales, List sends the price, and your listing shows', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  await $.command.run(RUN('gift shiny-foil'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80))
  expect((await ui.find({ key: 'sell' }))?.props.hotkey).toBe('l')
  await ui.press({ key: 'sell' })
  await settle(clock)
  expect(w.requests.some(r => r.url.startsWith(`${ORIGIN}/v1/market?species=`))).toBe(true)
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/craft cost/)
  const start = String((await ui.find({ key: 'list' }))?.props.label)
  expect(start).toMatch(/^List for ✧ [\d,]+$/)
  await ui.press({ key: 'price-up' })
  await ui.redraw()
  const higher = String((await ui.find({ key: 'list' }))?.props.label)
  expect(Number(higher.replace(/\D/g, ''))).toBeGreaterThan(Number(start.replace(/\D/g, '')))
  // one suggested price: the hint names its one key
  expect((await ui.find({ key: 'price-hint-0' }))?.props.hotkey).toBe('2')
  expect(textOf(await ui.drawn())).not.toMatch(/2-2 Suggested/)
  // asking for a card too keeps the price, and letting the card go keeps it still
  await ui.press({ key: 'want-0' })
  await ui.redraw()
  expect(String((await ui.find({ key: 'list' }))?.props.label).startsWith(`${higher} + `)).toBe(true)
  await ui.press({ key: 'want-0' })
  await ui.redraw()
  expect(String((await ui.find({ key: 'list' }))?.props.label)).toBe(higher)
  await ui.press({ key: 'list' })
  await settle(clock)
  const body = bodyOf(w, 'POST', '/v1/market') as { cardId: string; price: number }
  expect(body.cardId).toBe('shiny-foil')
  expect(body.price).toBe(Number(higher.replace(/\D/g, '')))
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/is on the market/)
  expect(await ui.find({ key: 'listing-listing-2-pick' })).toBeDefined()
  await ui.unmount()
})

test('a challenge by handle: /spin duel sends the handle and plays a friendly duel; boards and profiles carry Challenge', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  await $.command.run(RUN('duel soft-otter-42'))
  await settle(clock)
  expect(bodyOf(w, 'POST', '/v1/battles')).toEqual({ kind: 'duel', family: 'opus', handle: 'soft-otter-42' })
  const band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).toMatch(/A friendly challenge|soft-otter-42|Thistlewick/)
  await band.unmount()
  expect(w.logs.some(l => /Challenging soft-otter-42/.test(l))).toBe(true)
  await $.command.run(RUN('duel brave-wren-41'))
  expect(w.logs.at(-1)).toMatch(/That is you/)
})

test('a Challenge that never starts leaves no word of challenging, only why', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  const handle = w.server.handle
  w.server.handle = (url, init) => (url === `${ORIGIN}/v1/battles` && init?.method === 'POST'
    ? { status: 404, ok: false, headers: { 'content-type': 'application/json' }, text: JSON.stringify({ error: { code: 'not_found', message: 'no such player' } }) }
    : handle(url, init))
  await $.command.run(RUN('leaderboard'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'rank-0-duel' })
  await settle(clock)
  await ui.redraw()
  expect(textOf(await ui.drawn())).not.toMatch(/Challenging/)
  await ui.unmount()
  const band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).toMatch(/There is no misty-lark-18 to challenge/)
  await band.unmount()
})

test('the boards: switch boards and periods, your rank pinned, a row opens the profile with stat tiles and Challenge', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  await $.command.run(RUN('leaderboard'))
  await settle(clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [50, 80, 120]) {
      const ui = await $.ui.mount({ ...PANE(columns), surface })
      const text = textOf(await ui.drawn())
      expect(text).toMatch(/misty-lark-18/)
      expect(text).toMatch(/You · brave-wren-41/)
      // the league as a named badge where the row has room, a coloured mark where it does not
      if (columns >= 80) expect(text).toMatch(/▪ Star/)
      expect((await ui.find({ key: 'board-beaten' }))?.props.hotkey).toBe('n')
      await ui.unmount()
    }
  }
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'board-sales' })
  await settle(clock)
  expect(urls(w)).toContain('GET /v1/leaderboards?board=sales&period=all')
  await ui.press({ key: 'period-season' })
  await settle(clock)
  expect(urls(w)).toContain('GET /v1/leaderboards?board=sales&period=season')
  expect(await ui.find({ key: 'rank-0-duel' })).toBeDefined()
  await ui.press({ key: 'rank-0-who' })
  await settle(clock)
  expect(urls(w)).toContain('GET /v1/players/misty-lark-18')
  await ui.redraw()
  const text = textOf(await ui.drawn())
  expect(text).toMatch(/30duel wins/)
  expect(text).toMatch(/11players beaten/)
  expect((await ui.find({ key: 'challenge' }))?.props.hotkey).toBe('c')
  await ui.press({ key: 'challenge' })
  await settle(clock)
  expect(bodyOf(w, 'POST', '/v1/battles')).toEqual({ kind: 'duel', family: 'opus', handle: 'misty-lark-18' })
  await ui.redraw()
  expect(textOf(await ui.drawn())).toMatch(/Challenging misty-lark-18 above the prompt/)
  await ui.unmount()
})

test('a sale while away shows the creature in the band; then the passkey is offered with it, once that day', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  const shiny = w.server.cards.find(c => c.id === 'shiny-foil')!
  const listing = { id: 'listing-mine', seller: 'brave-wren-41', card: shiny, price: 75, day: '2026-10-02', state: 'open' as const }
  w.server.me = { ...w.server.me, listings: [listing] }
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  // sold while away: the listing is gone and a notice names the buyer
  w.server.me = {
    ...w.server.me, listings: [],
    notices: [{ id: 'n-sold', day: '2026-10-02', kind: 'market-sold', text: 'Your card sold for 75 sparks', handle: 'misty-lark-18' }],
  }
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND(80), surface })
    const text = textOf(await band.drawn())
    expect(text).toMatch(/Sold!/)
    expect(text).toMatch(/went to misty-lark-18/)
    expect(text).toMatch(/\+✧ 75/)
    expect(walk(await band.drawn()).some(n => n.type === (surface === 'terminal' ? 'Raster' : 'Svg'))).toBe(true)
    await band.unmount()
  }
  let band = await $.ui.mount(BAND(80))
  await band.press({ key: 'act-market:n-sold' })
  await band.redraw()
  expect(textOf(await band.drawn())).toMatch(/lives only on this computer/)
  await band.unmount()
  // the pane header carries the marker until a passkey is saved
  const pane = await $.ui.mount(PANE(80))
  expect(await pane.find({ key: 'not-backed-up' })).toBeDefined()
  await pane.unmount()
  band = await $.ui.mount(BAND(80))
  await band.press({ key: 'dismiss-passkey' })
  await band.unmount()
  // a second sale the same day: the creature shows, the offer waits for another day
  w.server.me = {
    ...w.server.me, listings: [],
    notices: [{ id: 'n-sold-2', day: '2026-10-02', kind: 'market-sold', text: 'Your card sold for 75 sparks', handle: 'quiet-fern-07' }, ...w.server.me.notices],
  }
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  band = await $.ui.mount(BAND(80))
  await band.press({ key: 'act-market:n-sold-2' })
  await band.redraw()
  expect(textOf(await band.drawn())).not.toMatch(/lives only on this computer/)
  await band.unmount()
})

test('sales and lapses are paired with their listings by price and age, never by position', () => {
  const base = fakeServer().cards[0]!
  const listing = (id: string, price: number, day: string): ListingView => ({ id, seller: 'brave-wren-41', card: toBattleCard({ ...base, id }), price, day, state: 'open' })
  const notice = (id: string, kind: Notice['kind'], text: string): Notice => ({ id, day: '2026-10-02', kind, text })
  expect(soldPrice('Your card sold for 75 sparks')).toBe(75)
  expect(soldPrice('Your card sold for 1,200 sparks and a card')).toBe(1200)
  expect(soldPrice('Your card sold for a card in return')).toBe(0)
  expect(soldPrice('something new')).toBeNull()
  // listed oldest first, sold the other way round: each sale still names its own creature and price
  const gone = [listing('first', 40, '2026-10-01'), listing('second', 75, '2026-10-01'), listing('swap', 0, '2026-10-01')]
  const paired = pairMarketNotices([
    notice('a', 'market-sold', 'Your card sold for 75 sparks'),
    notice('b', 'market-sold', 'Your card sold for a card in return'),
    notice('c', 'market-sold', 'Your card sold for 40 sparks'),
  ], gone, NOW)
  expect(paired.get('a')).toMatchObject({ price: 75 })
  expect(paired.get('a')!.card?.id).toBe('second')
  expect(paired.get('b')!.card?.id).toBe('swap')
  expect(paired.get('c')!.card?.id).toBe('first')
  // a lapse takes the listing past its 14 days, not a newer one taken off elsewhere
  const lapse = pairMarketNotices([notice('x', 'market-expired', 'Your listing ran out of time, so your card is home again')],
    [listing('new', 50, '2026-10-01'), listing('old', 50, '2026-09-17')], NOW)
  expect(lapse.get('x')!.card?.id).toBe('old')
  // two listings at the price sold: no guessing, the band says "Your card" with the price the notice states
  const twin = pairMarketNotices([notice('t', 'market-sold', 'Your card sold for 60 sparks')], [listing('p', 60, '2026-10-01'), listing('q', 60, '2026-10-01')], NOW)
  expect(twin.get('t')).toEqual({ card: null, price: 60 })
  // a listing still within its days never passes for a lapse
  expect(pairMarketNotices([notice('y', 'market-expired', '')], [listing('young', 50, '2026-09-20')], NOW).get('y')!.card).toBeNull()
})

test('a listing taken off by hand never passes for a sale: a sale at the same moment still shows its own creature', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  const others = w.server.cards.filter(c => c.id !== 'shiny-foil')
  const a = others[0]!
  const b = others.find(c => nameOf(c) !== nameOf(a))!
  const mine = (id: string, c: typeof a) => ({ id, seller: 'brave-wren-41', card: toBattleCard(c), price: 30, day: '2026-10-02', state: 'open' as const })
  w.server.me = { ...w.server.me, listings: [mine('listing-a', a), mine('listing-b', b)] }
  for (let m = 0; m < 6; m++) await clock.advance(60_000)
  await settle(clock)
  await $.command.run(RUN('market'))
  await settle(clock)
  const ui = await $.ui.mount(PANE(80))
  await ui.press({ key: 'market-mine' })
  await settle(clock)
  await ui.press({ key: 'listing-listing-a-pick' })
  await settle(clock)
  // listing-b sells at the same price just before listing-a comes off: the read after the take-off brings the sale
  w.server.me = {
    ...w.server.me, listings: [mine('listing-a', a)],
    notices: [{ id: 'n-sold-b', day: '2026-10-02', kind: 'market-sold', text: 'Your card sold for 30 sparks', handle: 'misty-lark-18' }],
  }
  await ui.press({ key: 'cancel-listing' })
  await clock.advance(2_100)
  await ui.press({ key: 'cancel-listing' })
  await settle(clock)
  expect(urls(w)).toContain('POST /v1/market/listing-a/cancel')
  await ui.unmount()
  const band = await $.ui.mount(BAND(80))
  const text = textOf(await band.drawn())
  expect(text).toMatch(/Sold!/)
  expect(text).toContain(nameOf(b))
  expect(text).not.toContain(nameOf(a))
  await band.unmount()
})

test('the passkey offer waits for the reveal: no creature is named while its card is still face down', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  // the pack holds a legendary, a card worth keeping
  const handle = w.server.handle
  w.server.handle = (url, init) => {
    const a = handle(url, init)
    if (url === `${ORIGIN}/v1/packs/open` && a.ok) {
      const { cards } = JSON.parse(a.text) as { cards: { rarity: string }[] }
      return { ...a, text: JSON.stringify({ cards: cards.map((c, i) => (i === cards.length - 1 ? { ...c, rarity: 'legendary' } : c)) }) }
    }
    return a
  }
  await $.command.run(RUN(''))
  await settle(clock)
  const pane = await $.ui.mount(PANE(80))
  await pane.press({ key: 'open-pack' })
  await settle(clock)
  let band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).not.toMatch(/lives only on this computer/)
  await band.unmount()
  for (let i = 0; i < 10 && !(await pane.find({ key: 'done' })); i++) {
    await pane.press({ key: 'flip' })
    await settle(clock)
    await pane.redraw()
  }
  band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).not.toMatch(/lives only on this computer/)
  await band.unmount()
  await pane.press({ key: 'done' })
  await settle(clock)
  await pane.unmount()
  // every card face up and put away: once the first-run hint has had its moment, the offer names the legendary
  await clock.advance(11_000)
  await settle(clock)
  band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).toMatch(/lives only on this computer/)
  await band.unmount()
})

test('a passkey saved: the header marker goes and no offer comes again', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  w.server.poll = 'added'
  await $.command.run(RUN('devices'))
  await settle(clock)
  const pane = await $.ui.mount(PANE(80))
  expect(await pane.find({ key: 'not-backed-up' })).toBeUndefined()
  expect((w.store.get(`server:${ORIGIN}:meta`) as { passkeyDay: string }).passkeyDay).toBe('saved')
  await pane.unmount()
})

test('the welcome leaves the band once its pack is opened from the pane, not only from the band', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start(SESSION)
  await settle(clock)
  let band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).toMatch(/A Spinling hatched!/)
  await band.unmount()
  await $.command.run(RUN(''))
  await settle(clock)
  const pane = await $.ui.mount(PANE(80))
  await pane.press({ key: 'open-pack' })
  await settle(clock)
  await pane.unmount()
  band = await $.ui.mount(BAND(80))
  expect(textOf(await band.drawn())).not.toMatch(/A Spinling hatched!/)
  await band.unmount()
})

test('short turns add up: three 8-second turns bring the first encounter, which a new player always meets', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on)
  await started($, clock)
  const starts = () => w.server.calls.filter(c => c.path === '/v1/battles')
  for (let t = 0; t < 2; t++) {
    await $.turn.start({ text: 'x', turnId: `t${t}` } as never)
    await clock.advance(8_000)
    await $.turn.complete({ answer: '', durationMs: 8_000, isAborted: false, turnId: `t${t}`, reason: 'answer' } as never)
    await settle(clock)
    await clock.advance(60_000)
  }
  expect(starts().length).toBe(0)
  await $.turn.start({ text: 'x', turnId: 't2' } as never)
  await clock.advance(3_500)
  expect(starts().length).toBe(0)
  await clock.advance(1_000)
  await settle(clock)
  expect(starts().length).toBe(1)
  expect(JSON.parse(starts()[0]!.body)).toEqual({ kind: 'wild', family: 'opus' })
})

test('offline: no Market tab, no boards, no challenge, no backup marker, and nothing is sent', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = engine(on, fakeServer())
  w.store.set('prefs', { world: 'offline' })
  await $.session.start(SESSION)
  await settle(clock)
  for (const args of ['market', 'leaderboard', 'duel soft-otter-42', '']) {
    expect(await $.command.run(RUN(args))).toEqual({})
    await settle(clock)
  }
  expect(w.requests).toEqual([])
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE(80), surface })
    expect(await pane.find({ key: 'tab-market' })).toBeUndefined()
    expect((await pane.find({ key: 'tab-trade' }))?.props.hotkey).toBe('4')
    expect(await pane.find({ key: 'boards' })).toBeUndefined()
    expect(await pane.find({ key: 'not-backed-up' })).toBeUndefined()
    await pane.unmount()
  }
  expect(w.requests).toEqual([])
})

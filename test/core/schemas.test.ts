import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BattleCard, Card } from '../../plugin/hooks/core/types.ts'
import type { ApiOp, GiftView, MeResponse, OfferView, PlayerView } from '../../plugin/hooks/core/api.ts'
import { API_ROUTES, routeOf } from '../../plugin/hooks/core/api.ts'
import * as V from '../../plugin/hooks/core/schemas.ts'
import { PATH_PARAMS, REQUEST_SCHEMAS, RESPONSE_SCHEMAS, SchemaError, cleanText, parse, parsePathParam, parseRequest } from '../../plugin/hooks/core/schemas.ts'
import type { Schema } from '../../plugin/hooks/core/schemas.ts'
import { RULES_VERSION, simulateBattle } from '../../plugin/hooks/core/battle.ts'
import { fuse, toBattleCard } from '../../plugin/hooks/core/cards.ts'
import { promoCard } from '../../plugin/hooks/core/drops.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rollWildTeam } from '../../plugin/hooks/core/packs.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { traderDeals } from '../../plugin/hooks/core/trader.ts'
import { card, NOW, speciesOf } from './helpers.ts'

const c1: Card = card(speciesOf('haiku', 1), { id: 'card_1' }, 101)
const c2: Card = card(speciesOf('opus', 2), { id: 'card_2', rarity: 'epic', traits: ['swift', 'mimic'], level: 5, stage: 2, raisedIn: 'fable' }, 102)
const hybrid: Card = { ...fuse(c1, c2, rngFromSeed('h'), NOW), id: 'card_3' }
const mythic: Card = { ...generateMythic({ seed: 'mythicseed', dna: 9, now: NOW, level: 4 }), id: 'card_4' }
const promo: Card = { ...promoCard({ seed: 'founders-1', name: 'Foundling', family: 'sonnet', rarity: 'rare', foil: true, stamp: 'Founder · Oct 2026' }, 77, NOW), id: 'card_5' }
const bc: BattleCard = toBattleCard(c1)
const wild = rollWildTeam({ rng: rngFromSeed('w'), arena: 'haiku', now: NOW, level: 3 })
const player: PlayerView = {
  handle: 'soft-otter-42', handleRerollFrom: '2026-10-11', sparks: 120, rating: 1000, league: 'Pebble', leaderboard: false,
  joinedDay: '2026-10-04', battles: 4, canTrade: false, team: ['card_1'], wishlist: ['s1-opus-3'], cardsVersion: 3, streak: 2,
  seen: ['s1-haiku-1'], rested: true, nextWildAt: NOW, nextDuelAt: NOW, nextChargeAt: NOW + 60_000,
}
const offer: OfferView = { id: 'o1', from: 'soft-otter-42', to: 'brave-wren-7', give: [bc], get: [], state: 'open', createdAt: NOW, expiresAt: NOW + 1 }
const gift: GiftView = { code: 'quiet-otter-lamp-4821', card: c1, createdAt: NOW, expiresAt: NOW + 5 }
const pack = { id: 'pk1', family: 'fable', source: 'welcome', day: '2026-10-04' }
const me: MeResponse = {
  player,
  packs: [pack as MeResponse['packs'][number]],
  notices: [
    { id: 'n1', day: '2026-10-04', kind: 'evolved', text: 'Pipkin evolved into Pipmaw' },
    { id: 'n2', day: '2026-10-03', kind: 'defense-loss', text: 'brave-wren-7 beat your team', handle: 'brave-wren-7' },
  ],
  offers: { incoming: [offer], outgoing: [] },
  gifts: [gift, { ...gift, claimedBy: 'brave-wren-7' }],
  now: NOW,
}
const setup = { seed: 'b-1', kind: 'wild', arena: 'haiku', rule: 'calm', rules: RULES_VERSION, attacker: [bc], defender: wild }
const log = simulateBattle(setup as never, [3])
const deals = traderDeals(NOW).map((d, i) => ({ ...d, used: i === 0 }))
const token = 'tok_0123456789abcdefghijKLMN'

type Kind = 'request' | 'response' | 'domain'
const samples: [string, Schema<unknown>, unknown, Kind][] = [
  ['Card', V.cardSchema, c1, 'domain'],
  ['Card (fusion)', V.cardSchema, hybrid, 'domain'],
  ['Card (mythic)', V.cardSchema, mythic, 'domain'],
  ['Card (promo)', V.cardSchema, promo, 'domain'],
  ['BattleCard', V.battleCardSchema, bc, 'domain'],
  ['BattleSetup', V.battleSetupSchema, setup, 'domain'],
  ['BattleLog', V.battleLogSchema, log, 'domain'],
  ['Form', V.formSchema, { ...speciesOf('fable', 3), id: undefined, season: undefined, index: undefined }, 'domain'],
  ['Species', V.speciesSchema, speciesOf('fable', 8), 'domain'],
  ['Stats', V.statsSchema, { hp: 44, atk: 17.5, def: 12, spd: 17 }, 'domain'],
  ['TraderDeal', V.traderDealSchema, traderDeals(NOW)[0], 'domain'],
  ['ApiError', V.apiErrorSchema, { error: { code: 'cap_reached', message: 'Every egg has hatched' } }, 'response'],
  ['PlayerView', V.playerViewSchema, player, 'response'],
  ['PackView', V.packViewSchema, pack, 'response'],
  ['Notice', V.noticeSchema, me.notices[1], 'response'],
  ['OfferView', V.offerViewSchema, offer, 'response'],
  ['GiftView', V.giftViewSchema, gift, 'response'],
  ['MeResponse', V.meResponseSchema, me, 'response'],
  ['VersionResponse', V.versionResponseSchema, { api: 1, server: '1.4.0', rules: 1, generator: 1, minClient: '1.0.0', latestClient: '1.4.2-beta.1', sunset: { api: 1, date: '2027-06-01' }, features: ['rivals', 'trader'] }, 'response'],
  ['SeasonResponse', V.seasonResponseSchema, { season: 1, generator: 1, species: seasonSpecies(1) }, 'response'],
  ['WorldResponse', V.worldResponseSchema, { day: '2026-10-04', season: 1, rule: 'glassDay', featured: 's1-haiku-3', roamer: 's1-opus-8', players: 12 }, 'response'],
  ['ChallengeResponse', V.challengeResponseSchema, { challenge: 'abcDEF123_-xyz', difficulty: 16 }, 'response'],
  ['JoinRequest', V.joinRequestSchema, { challenge: 'abcDEF123_-xyz', nonce: '1z9', family: 'opus' }, 'request'],
  ['JoinResponse', V.joinResponseSchema, { token, me }, 'response'],
  ['TokenResponse', V.tokenResponseSchema, { token }, 'response'],
  ['DevicesResponse', V.devicesResponseSchema, { sessions: 2, passkeys: 1 }, 'response'],
  ['AuthStartResponse', V.authStartResponseSchema, { url: 'https://spinlings.dev/passkey/signin?p=abc', pollId: 'abc' }, 'response'],
  ['AuthPollResponse (pending)', V.authPollResponseSchema, { status: 'pending' }, 'response'],
  ['AuthPollResponse (added)', V.authPollResponseSchema, { status: 'added' }, 'response'],
  ['AuthPollResponse (done)', V.authPollResponseSchema, { status: 'done', token, me }, 'response'],
  ['HandleResponse', V.handleResponseSchema, { handle: 'brave-wren-41', handleRerollFrom: '2026-10-11' }, 'response'],
  ['LeaderboardOptRequest', V.leaderboardOptRequestSchema, { optIn: true }, 'request'],
  ['LeaderboardOptResponse', V.leaderboardOptResponseSchema, { leaderboard: true }, 'response'],
  ['CardsResponse', V.cardsResponseSchema, { cards: [c1, c2, hybrid, mythic, promo], version: 9 }, 'response'],
  ['ChargeRequest', V.chargeRequestSchema, { family: 'haiku' }, 'request'],
  ['BuyPackRequest', V.buyPackRequestSchema, { family: 'opus' }, 'request'],
  ['PacksResponse', V.packsResponseSchema, { packs: me.packs }, 'response'],
  ['EmptyRequest', V.emptyRequestSchema, {}, 'request'],
  ['OpenPackRequest', V.openPackRequestSchema, { packId: 'pk1' }, 'request'],
  ['OpenPackResponse', V.openPackResponseSchema, { cards: [c1, c2] }, 'response'],
  ['TeamRequest', V.teamRequestSchema, { cardIds: ['card_1', 'card_2'] }, 'request'],
  ['TeamResponse', V.teamResponseSchema, { team: ['card_1'] }, 'response'],
  ['StartBattleRequest', V.startBattleRequestSchema, { kind: 'duel', family: 'sonnet', revenge: 'brave-wren-7' }, 'request'],
  ['StartBattleResponse (wild)', V.startBattleResponseSchema, { id: 'b1', setup, opponent: { kind: 'wild' }, subs: [], firstPossible: [true], startedAt: NOW, finishAfter: NOW + 9000 }, 'response'],
  ['StartBattleResponse (duel)', V.startBattleResponseSchema, { id: 'b1', setup: { ...setup, kind: 'duel' }, opponent: { kind: 'player', handle: 'brave-wren-7', league: 'Grove' }, subs: [{ slot: 1, cardId: 'card_2', replaced: null }], firstPossible: [false], startedAt: NOW, finishAfter: NOW }, 'response'],
  ['StartBattleResponse (rival)', V.startBattleResponseSchema, { id: 'b1', setup: { ...setup, kind: 'duel' }, opponent: { kind: 'rival', name: 'Thistlewick', league: 'Brook' }, subs: [], firstPossible: [false], startedAt: NOW, finishAfter: NOW }, 'response'],
  ['FinishBattleRequest', V.finishBattleRequestSchema, { inputs: [3, 6, 9] }, 'request'],
  ['FinishBattleResponse', V.finishBattleResponseSchema, {
    result: 'win', sparks: 10, xp: [{ cardId: 'card_1', xp: 20, levelsGained: 1, evolved: true, stage: 2 }], rating: 1000, ratingDelta: 0,
    catchOptions: wild, bounty: null, dailyWinPack: true, streak: 3, streakPack: true, tired: [], log,
  }, 'response'],
  ['CatchRequest', V.catchRequestSchema, { index: 2 }, 'request'],
  ['CardResponse', V.cardResponseSchema, { card: mythic }, 'response'],
  ['FuseRequest', V.fuseRequestSchema, { otherId: 'card_2' }, 'request'],
  ['FuseResponse', V.fuseResponseSchema, { card: hybrid, consumed: ['card_1', 'card_2'] }, 'response'],
  ['RecycleResponse', V.recycleResponseSchema, { sparks: 130, gained: 5 }, 'response'],
  ['ForTradeRequest', V.forTradeRequestSchema, { forTrade: true }, 'request'],
  ['CraftRequest', V.craftRequestSchema, { speciesId: 's1-fable-4', rarity: 'rare' }, 'request'],
  ['WishlistRequest', V.wishlistRequestSchema, { species: ['s1-fable-4', 's2-opus-8'] }, 'request'],
  ['WishlistResponse', V.wishlistResponseSchema, { wishlist: ['s1-fable-4'] }, 'response'],
  ['ProfileResponse', V.profileResponseSchema, { handle: 'brave-wren-7', league: 'Star', team: [bc], forTrade: [toBattleCard(c2)], seenCount: 12 }, 'response'],
  ['BoardResponse', V.boardResponseSchema, { matches: [{ handle: 'brave-wren-7', theirs: toBattleCard(c2), mine: bc }], recent: [{ handle: 'x-y-1', card: toBattleCard(hybrid) }], trader: deals }, 'response'],
  ['OfferRequest', V.offerRequestSchema, { to: 'brave-wren-7', give: ['card_1'], get: [] }, 'request'],
  ['OfferResponse', V.offerResponseSchema, { offer }, 'response'],
  ['CounterRequest', V.counterRequestSchema, { give: ['card_1'], get: ['card_9'] }, 'request'],
  ['GiftRequest', V.giftRequestSchema, { cardId: 'card_1' }, 'request'],
  ['GiftResponse', V.giftResponseSchema, { gift }, 'response'],
  ['ClaimRequest', V.claimRequestSchema, { code: 'quiet-otter-lamp-4821' }, 'request'],
  ['LeaderboardResponse', V.leaderboardResponseSchema, { top: [{ handle: 'brave-wren-7', league: 'Peak', rating: 1520 }] }, 'response'],
  ['DeleteResponse', V.deleteResponseSchema, { deleted: true }, 'response'],
  ['RedeemRequest', V.redeemRequestSchema, { code: 'GOLDEN-7Q2M-K9XD' }, 'request'],
  ['RedeemResponse', V.redeemResponseSchema, { cards: [promo], packs: [{ ...pack, source: 'promo' }] }, 'response'],
  ['TraderResponse', V.traderResponseSchema, { day: '2026-10-04', deals }, 'response'],
  ['TraderDealRequest', V.traderDealRequestSchema, { cardIds: ['card_1', 'card_2'] }, 'request'],
  ['TraderDealResponse', V.traderDealResponseSchema, { cards: [c2], packs: [], consumed: ['card_1', 'card_9'] }, 'response'],
]

function throwsAt(fn: () => unknown, path: string | RegExp) {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof SchemaError, String(e))
    if (typeof path === 'string') assert.equal(e.path, path, e.message)
    else assert.match(e.path, path, e.message)
    return
  }
  assert.fail(`expected a SchemaError at ${path}`)
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

test('every schema accepts a realistic value and returns an equal, fresh copy', () => {
  for (const [name, schema, value] of samples) {
    const clean = json(value)
    const out = parse(schema, clean)
    assert.deepEqual(out, clean, name)
    assert.notEqual(out, clean, `${name} returns a fresh object`)
  }
})

test('requests reject unknown keys, naming them; responses strip them', () => {
  for (const [name, schema, value, kind] of samples) {
    const clean = json(value) as Record<string, unknown>
    if (kind === 'request') throwsAt(() => parse(schema, { ...clean, sneaky: 1 }), '$.sneaky')
    else assert.deepEqual(parse(schema, { ...clean, sneaky: 1, futureField: { a: 1 } }), clean, `${name} strips unknown keys`)
  }
  assert.deepEqual(parse(V.meResponseSchema, json({ ...me, player: { ...player, extra: 0 } })), json(me))
  assert.deepEqual(parse(V.cardsResponseSchema, { cards: [json(c1), { ...json(c2), cash: 5 }], version: 1 }), json({ cards: [c1, c2], version: 1 }))
  assert.deepEqual(parse(V.fuseResponseSchema, json({ card: { ...hybrid, form: { ...hybrid.form, hidden: true } }, consumed: ['a', 'b'] })).card, json(hybrid))
  const proto = parse(V.cardSchema, JSON.parse(JSON.stringify(c1).replace('{', '{"__proto__":{"admin":true},')))
  assert.equal((proto as unknown as Record<string, unknown>).admin, undefined)
  assert.equal(Object.getPrototypeOf(proto), Object.prototype)
  throwsAt(() => parse(V.offerRequestSchema, JSON.parse('{"__proto__":{"admin":true},"to":"x","give":["a"],"get":[]}')), '$.__proto__')
  assert.equal(({} as Record<string, unknown>).admin, undefined)
})

test('tolerant reader: an unknown enum value maps to its safe fallback', () => {
  assert.equal(parse(V.noticeSchema, { ...me.notices[0], kind: 'meteor-shower' }).kind, 'notice')
  assert.equal(parse(V.cardSchema, { ...json(c1), origin: 'meteor' }).origin, 'unknown')
  assert.equal(parse(V.cardSchema, { ...json(c1), traits: ['stargazer'] }).traits[0], 'stargazer', 'an unknown trait is kept by id')
  assert.equal(parse(V.cardSchema, { ...json(c1), rarity: 'cosmic' }).rarity, 'common')
  assert.equal(parse(V.packViewSchema, { ...pack, source: 'festival' }).source, 'bonus')
  assert.equal(parse(V.worldResponseSchema, { day: '2026-10-04', season: 1, rule: 'rainDay', featured: 's1-haiku-3', roamer: 's1-opus-8', players: 1 }).rule, 'calm')
  assert.equal(parse(V.playerViewSchema, { ...player, league: 'Comet' }).league, 'Pebble')
  assert.equal(parse(V.offerViewSchema, { ...json(offer), state: 'paused' }).state, 'expired')
  assert.equal(parse(V.apiErrorSchema, { error: { code: 'teapot', message: 'x' } }).error.code, 'unavailable')
  assert.deepEqual(parse(V.authPollResponseSchema, { status: 'thinking' }), { status: 'pending' })
  const base = { id: 'b1', setup, subs: [], firstPossible: [], startedAt: NOW, finishAfter: NOW }
  assert.deepEqual(parse(V.startBattleResponseSchema, json({ ...base, opponent: { kind: 'ghost-ship', name: 'x' } })).opponent, { kind: 'wild' })
  // but known fields keep their types, formats and ranges
  throwsAt(() => parse(V.noticeSchema, { ...me.notices[0], kind: 7 }), '$.kind')
  throwsAt(() => parse(V.cardSchema, { ...json(c1), family: 'dragon' }), '$.family')
  throwsAt(() => parse(V.cardSchema, { ...json(c1), traits: ['not a trait!'] }), '$.traits[0]')
})

test('types, ranges, formats and required keys', () => {
  const c = json(c1)
  throwsAt(() => parse(V.cardSchema, { ...c, level: 11 }), '$.level')
  throwsAt(() => parse(V.cardSchema, { ...c, level: 2.5 }), '$.level')
  throwsAt(() => parse(V.cardSchema, { ...c, stage: 4 }), '$.stage')
  throwsAt(() => parse(V.cardSchema, { ...c, genes: [1, 2, 3] }), '$.genes')
  throwsAt(() => parse(V.cardSchema, { ...c, genes: [1, 2, 3, 16] }), '$.genes[3]')
  throwsAt(() => parse(V.cardSchema, { ...c, dna: -1 }), '$.dna')
  throwsAt(() => parse(V.cardSchema, { ...c, species: 's1-haiku-9' }), '$.species')
  throwsAt(() => parse(V.cardSchema, { ...c, species: 's1-haiku-1x' }), '$.species')
  throwsAt(() => parse(V.cardSchema, { ...c, id: 'has space' }), '$.id')
  throwsAt(() => parse(V.cardSchema, { ...c, id: 'x'.repeat(65) }), '$.id')
  throwsAt(() => parse(V.cardSchema, { ...c, shiny: 'yes' }), '$.shiny')
  throwsAt(() => parse(V.cardSchema, { ...c, traits: ['swift', 'swift'] }), '$.traits')
  throwsAt(() => parse(V.cardSchema, { ...c, mintedAt: Number.NaN }), '$.mintedAt')
  throwsAt(() => parse(V.cardSchema, { ...c, mintedAt: Infinity }), '$.mintedAt')
  throwsAt(() => parse(V.cardSchema, { ...c, stats: { ...c.stats, hp: 1.5 } }), '$.stats.hp')
  throwsAt(() => parse(V.cardSchema, { ...c, raisedIn: 'dragon' }), '$.raisedIn')
  const { xp: _xp, ...noXp } = c
  throwsAt(() => parse(V.cardSchema, noXp), '$.xp')
  const { stats: _stats, ...noStats } = c
  throwsAt(() => parse(V.cardSchema, noStats), '$.stats')
  throwsAt(() => parse(V.cardSchema, [c]), '$')
  throwsAt(() => parse(V.cardSchema, null), '$')
  throwsAt(() => parse(V.cardSchema, 'card'), '$')
  throwsAt(() => parse(V.cardSchema, { ...json(mythic), form: { ...json(mythic.form), names: ['Bad name', 'x', 'y'] } }), '$.form.names[0]')
  throwsAt(() => parse(V.joinRequestSchema, { challenge: 'abcDEF123_-xyz', nonce: 'NOPE!', family: 'opus' }), '$.nonce')
  throwsAt(() => parse(V.joinRequestSchema, { challenge: 'abcDEF123_-xyz', nonce: '1', family: 'gpt' }), '$.family')
  throwsAt(() => parse(V.claimRequestSchema, { code: 'quiet-otter-lamp-482' }), '$.code')
  throwsAt(() => parse(V.claimRequestSchema, { code: 'quiet-otter-lamp-4821; drop' }), '$.code')
  throwsAt(() => parse(V.redeemRequestSchema, { code: 'GOLD;EN' }), '$.code')
  throwsAt(() => parse(V.redeemRequestSchema, { code: 'x'.repeat(41) }), '$.code')
  throwsAt(() => parse(V.craftRequestSchema, { speciesId: 's1-fable-4', rarity: 'cosmic' }), '$.rarity')
  throwsAt(() => parse(V.worldResponseSchema, { day: '2026-13-01', season: 1, rule: 'calm', featured: 's1-haiku-3', roamer: 's1-opus-8', players: 1 }), '$.day')
  const esc = String.fromCharCode(27)
  throwsAt(() => parse(V.noticeSchema, { ...me.notices[0], text: `evil${esc}[31mred` }), '$.text')
  throwsAt(() => parse(V.noticeSchema, { ...me.notices[0], text: 'x'.repeat(201) }), '$.text')
  throwsAt(() => parse(V.authStartResponseSchema, { url: 'javascript:alert(1)', pollId: 'p' }), '$.url')
  throwsAt(() => parse(V.versionResponseSchema, { api: 1, server: 'one', rules: 1, generator: 1, minClient: '1.0.0', latestClient: '1.0.0', features: [] }), '$.server')
  throwsAt(() => parse(V.seasonResponseSchema, { season: 1, generator: 1, species: seasonSpecies(1).slice(1) }), '$.species')
  throwsAt(() => parse(V.seasonResponseSchema, json({ season: 2, generator: 1, species: seasonSpecies(1) })), '$')
})

test('arrays: limits, uniqueness and ordering rules', () => {
  throwsAt(() => parse(V.teamRequestSchema, { cardIds: ['a', 'b', 'c', 'd'] }), '$.cardIds')
  throwsAt(() => parse(V.teamRequestSchema, { cardIds: ['a', 'a'] }), '$.cardIds')
  throwsAt(() => parse(V.wishlistRequestSchema, { species: ['s1-haiku-1', 's1-haiku-2', 's1-haiku-3', 's1-haiku-4', 's1-haiku-5', 's1-haiku-6'] }), '$.species')
  throwsAt(() => parse(V.offerRequestSchema, { to: 'x', give: [], get: [] }), '$.give')
  throwsAt(() => parse(V.offerRequestSchema, { to: 'x', give: ['a', 'b', 'c', 'd'], get: [] }), '$.give')
  throwsAt(() => parse(V.traderDealRequestSchema, { cardIds: [] }), '$.cardIds')
  throwsAt(() => parse(V.traderDealRequestSchema, { cardIds: ['a', 'a'] }), '$.cardIds')
  throwsAt(() => parse(V.finishBattleRequestSchema, { inputs: [3, 3] }), '$')
  throwsAt(() => parse(V.finishBattleRequestSchema, { inputs: [5, 2] }), '$')
  throwsAt(() => parse(V.finishBattleRequestSchema, { inputs: [0] }), '$.inputs[0]')
  throwsAt(() => parse(V.finishBattleRequestSchema, { inputs: [31] }), '$.inputs[0]')
  throwsAt(() => parse(V.battleSetupSchema, { ...setup, attacker: [] }), '$.attacker')
  throwsAt(() => parse(V.battleSetupSchema, { ...setup, defender: [bc, bc, bc, bc] }), '$.defender')
  throwsAt(() => parse(V.battleSetupSchema, { ...setup, seed: 'has space' }), '$.seed')
  const { rules: _r, ...noRules } = setup
  throwsAt(() => parse(V.battleSetupSchema, noRules), '$.rules')
})

test('cross-field rules on cards: an embedded form exactly for fusion, mythic and promo, matching kind and family', () => {
  throwsAt(() => parse(V.cardSchema, { ...json(c1), form: json(hybrid.form) }), '$')
  const { form: _f, ...bare } = json(hybrid)
  throwsAt(() => parse(V.cardSchema, bare), '$')
  throwsAt(() => parse(V.cardSchema, { ...json(mythic), species: 'fusion' }), /^\$/)
  throwsAt(() => parse(V.cardSchema, { ...json(c1), family: 'opus' }), '$')
  throwsAt(() => parse(V.cardSchema, { ...json(hybrid), family: hybrid.family === 'opus' ? 'haiku' : 'opus' }), '$')
  throwsAt(() => parse(V.cardFormSchema, { ...json(mythic.form), parents: ['s1-opus-1', 's1-opus-2'] }), '$')
})

test('discriminated unions', () => {
  const base = { id: 'b1', setup, subs: [], firstPossible: [], startedAt: NOW, finishAfter: NOW }
  throwsAt(() => parse(V.startBattleResponseSchema, { ...base, opponent: { kind: 7 } }), '$.opponent.kind')
  throwsAt(() => parse(V.startBattleResponseSchema, { ...base, opponent: { kind: 'player', handle: 'x' } }), '$.opponent.league')
  throwsAt(() => parse(V.startBattleResponseSchema, { ...base, opponent: { kind: 'rival', name: 'not a name', league: 'Star' } }), '$.opponent.name')
  throwsAt(() => parse(V.authPollResponseSchema, { status: 'done', me }), '$.token')
})

test('combinators: optional, nullable, tuple, bounds, strict and tolerant objects', () => {
  const s = V.S.obj<{ a: string; b?: number; c: number | null }>({ a: V.S.str({ max: 3 }), b: V.S.optional(V.S.int(0, 5)), c: V.S.nullable(V.S.num(-1, 1)) })
  assert.deepEqual(parse(s, { a: 'abc', c: null }), { a: 'abc', c: null })
  assert.deepEqual(parse(s, { a: 'abc', b: 5, c: 0.5 }), { a: 'abc', b: 5, c: 0.5 })
  assert.deepEqual(parse(s, { a: 'abc', b: undefined, c: 1 }), { a: 'abc', c: 1 })
  throwsAt(() => parse(s, { a: 'abcd', c: null }), '$.a')
  throwsAt(() => parse(s, { a: 'a', b: 6, c: null }), '$.b')
  throwsAt(() => parse(s, { a: 'a', c: 2 }), '$.c')
  throwsAt(() => parse(s, { a: 'a' }), '$.c')
  throwsAt(() => parse(s, { a: 'a', c: null, d: 1 }), '$.d')
  throwsAt(() => parse(s, Object.assign(Object.create({ inherited: 1 }), { a: 'a', c: null })), '$')
  const v = V.S.view<{ a: string }>({ a: V.S.str({ max: 3 }) })
  assert.deepEqual(parse(v, { a: 'x', d: 1 }), { a: 'x' })
  throwsAt(() => parse(v, { d: 1 }), '$.a')
  const t = V.S.tuple<[number, string]>(V.S.int(0, 1), V.S.str({ max: 1 }))
  assert.deepEqual(parse(t, [1, 'x']), [1, 'x'])
  throwsAt(() => parse(t, [1, 'x', 2]), '$')
  throwsAt(() => parse(t, [1, 7]), '$[1]')
  const e = V.S.oneOf(['a', 'b'] as const, 'a')
  assert.equal(parse(e, 'zzz'), 'a')
  throwsAt(() => parse(e, 3), '$')
  const err = (() => { try { parse(V.cardSchema, { ...json(c1), level: 0 }) } catch (x) { return x as SchemaError } })()!
  assert.equal(err.name, 'SchemaError')
  assert.match(err.message, /^\$\.level: out of range/)
})

test('no request schema accepts card data: cards, stats, genes, DNA or traits (SPEC section 28)', () => {
  const cardish: Record<string, unknown> = {
    card: json(c1), cards: [json(c1)], battleCard: json(bc), stats: json(c1.stats), genes: [15, 15, 15, 15], dna: 123, traits: ['swift'],
    species: 's1-haiku-1', form: json(hybrid.form), level: 10, rarity: 'legendary', shiny: true, foil: true, xp: 400,
  }
  const requests = samples.filter(([, , , kind]) => kind === 'request')
  for (const [name, schema, value] of requests) {
    const clean = json(value) as Record<string, unknown>
    for (const [k, v] of Object.entries(cardish)) {
      if (Object.hasOwn(clean, k)) continue
      assert.throws(() => parse(schema, { ...clean, [k]: v }), SchemaError, `${name} accepted ${k}`)
    }
    for (const k of Object.keys(clean)) for (const v of [json(c1), [json(c1)], json(c1.stats), json(bc)]) {
      assert.throws(() => parse(schema, { ...clean, [k]: v }), SchemaError, `${name}.${k} accepted card data`)
    }
  }
  // every operation's body goes through one of these strict schemas, or none at all
  for (const op of Object.keys(API_ROUTES) as ApiOp[]) {
    const s = REQUEST_SCHEMAS[op]
    if (s) assert.ok(requests.some(([, schema]) => schema === s), `${op} has a covered request schema`)
    assert.throws(() => parseRequest(op, { card: json(c1) }), SchemaError, op)
  }
})

test('the route table, request and response schemas and path parameters cover every operation', () => {
  const ops = Object.keys(API_ROUTES) as ApiOp[]
  assert.equal(ops.length, 41)
  for (const op of ops) {
    const route = API_ROUTES[op]
    assert.ok(Object.hasOwn(REQUEST_SCHEMAS, op) && Object.hasOwn(RESPONSE_SCHEMAS, op), op)
    assert.equal(REQUEST_SCHEMAS[op] === null, route.method === 'GET' || route.method === 'DELETE', `${op} body iff it sends one`)
    assert.match(route.path, /^\/v1\//)
    for (const [, param] of route.path.matchAll(/:([A-Za-z]+)/g)) assert.ok(Object.hasOwn(PATH_PARAMS, param!), `${op} :${param}`)
  }
  assert.equal(new Set(ops.map(op => `${API_ROUTES[op].method} ${API_ROUTES[op].path}`)).size, ops.length, 'routes are unique')
  assert.deepEqual(routeOf('finishBattle', { battleId: 'b 1', inputs: [3] }), { method: 'POST', path: '/v1/battles/b%201/finish', body: { inputs: [3] } })
  assert.deepEqual(routeOf('profile', { handle: 'soft-otter-42' }), { method: 'GET', path: '/v1/players/soft-otter-42', body: null })
  assert.deepEqual(routeOf('season', { season: 3 }), { method: 'GET', path: '/v1/season/3', body: null })
  assert.deepEqual(routeOf('recycle', { cardId: 'c1' }), { method: 'POST', path: '/v1/cards/c1/recycle', body: {} })
  assert.deepEqual(routeOf('cards', {}), { method: 'GET', path: '/v1/cards', body: null })
  assert.deepEqual(routeOf('cards', { after: '2026-10-02.abc' }), { method: 'GET', path: '/v1/cards?after=2026-10-02.abc', body: null })
  for (const op of ops) for (const q of API_ROUTES[op].query ?? []) {
    assert.equal(API_ROUTES[op].method, 'GET', `${op} ?${q}`)
    assert.ok(Object.hasOwn(PATH_PARAMS, q), `${op} ?${q}`)
  }
  assert.throws(() => routeOf('acceptOffer', {} as never), TypeError)
  assert.equal(parsePathParam('dealId', '2026-10-04-1'), '2026-10-04-1')
  assert.equal(parsePathParam('code', 'quiet-otter-lamp-4821'), 'quiet-otter-lamp-4821')
  throwsAt(() => parsePathParam('cardId', '../me'), '$.cardId')
  throwsAt(() => parsePathParam('season', '0'), '$.season')
  throwsAt(() => parsePathParam('nope', 'x'), '$.nope')
  const offline = ops.filter(op => API_ROUTES[op].offline)
  for (const op of ['me', 'cards', 'openPack', 'startBattle', 'finishBattle', 'fuse', 'craft', 'trader', 'traderDeal'] as ApiOp[]) assert.ok(offline.includes(op), op)
  for (const op of ['join', 'offer', 'gift', 'claim', 'redeem', 'leaderboard', 'profile', 'resetToken'] as ApiOp[]) assert.ok(!offline.includes(op), op)
})

test('drop rewards (reward_json) are parsed strictly', () => {
  const egg = { type: 'egg', promo: { seed: 'founders-1', name: 'Foundling', family: 'sonnet', rarity: 'rare', foil: true, stamp: 'Founder · Oct 2026' } }
  assert.deepEqual(parse(V.dropRewardSchema, egg), egg)
  const combo = [egg, { type: 'pack', count: 1 }, { type: 'pack', family: 'opus', count: 3 }, { type: 'card', rarity: 'epic' }]
  assert.deepEqual(parse(V.dropRewardSchema, combo), combo)
  throwsAt(() => parse(V.dropRewardSchema, { ...egg, promo: { ...egg.promo, name: 'Pikachu' } }), '$.promo')
  throwsAt(() => parse(V.dropRewardSchema, { ...egg, promo: { ...egg.promo, extra: 1 } }), '$.promo.extra')
  throwsAt(() => parse(V.dropRewardSchema, { type: 'pack', count: 4 }), '$.count')
  throwsAt(() => parse(V.dropRewardSchema, { type: 'gold', count: 1 }), '$.type')
  throwsAt(() => parse(V.dropRewardSchema, []), '$')
  throwsAt(() => parse(V.dropRewardSchema, [egg, { type: 'card', rarity: 'cosmic' }]), '$[1].rarity')
})

test('cleanText strips escapes, control and bidi characters, and cuts long text', () => {
  assert.equal(cleanText('Pip\u001b[31mkin\u001b[0m'), 'Pipkin')
  assert.equal(cleanText('a\u001b]8;;http://x\u0007link\u001b]8;;\u0007b'), 'alinkb')
  assert.equal(cleanText('line\nbreak\tand\u0000nul'), 'linebreakandnul')
  assert.equal(cleanText('evil‮eman'), 'evileman')
  assert.equal(cleanText('zero​width'), 'zerowidth')
  assert.equal(cleanText('x'.repeat(100), 10), 'x'.repeat(9) + '…')
  assert.equal(cleanText('🟩'.repeat(5), 3), '🟩🟩…')
  assert.equal(cleanText(42), '')
})

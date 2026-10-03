// The server foundation: typed routes, joining, /v1/me and touch, the public world routes, the
// version gate, frozen seasons, minting, pacing, notices, retention and total deletion.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FEATURES } from '../../plugin/hooks/core/api.ts'
import { RULES_VERSION } from '../../plugin/hooks/core/battle.ts'
import { cardFromBattleCard, fuse, starterTeam } from '../../plugin/hooks/core/cards.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { beatenBy, beats, FAMILIES } from '../../plugin/hooks/core/families.ts'
import { generateMythic } from '../../plugin/hooks/core/mythics.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { GIFT_CODE_RE, HANDLE_RE, ID_RE } from '../../plugin/hooks/core/schemas.ts'
import { GENERATOR_VERSION, getSpecies, isBlocked, seasonSpecies } from '../../plugin/hooks/core/species.ts'
import { mintFor } from '../../plugin/hooks/core/trader.ts'
import type { Card, Species } from '../../plugin/hooks/core/types.ts'
import { seasonStart, utcDay, worldOf } from '../../plugin/hooks/core/world.ts'
import { tooOld } from '../../server/src/app.ts'
import { proofBits } from '../../server/src/auth.ts'
import type { PlayerCtx } from '../../server/src/app.ts'
import { Conflict, stmt } from '../../server/src/db.ts'
import { HttpError } from '../../server/src/http.ts'
import type { PlayerRow } from '../../server/src/schema.ts'
import {
  apiRoute, base32, commit, ensureSeason, newGiftCode, newId, randomInt, requestOf, setPlayer,
} from '../../server/src/game/ctx.ts'
import { cardGuard, cardsOf, giftViews, grantPack, mintCards, offerViews, ownCard, ownCards, saveCard } from '../../server/src/game/mint.ts'
import { notice, noticesOf } from '../../server/src/game/notices.ts'
import {
  battleFinished, checkCharge, checkWildStart, markCharge, nextChargeAt, pairDuels, recentCharges, trusted,
} from '../../server/src/game/pacing.ts'
import { sweepGame } from '../../server/src/game/retention.ts'
import { roughCount } from '../../server/src/routes/account.ts'
import { counts, DAY, exact, HOUR, MINUTE, server, T0 } from './scaffold-helpers.ts'
import type { Player, Server } from './scaffold-helpers.ts'

const env = (s: Server) => ({ db: s.db, now: s.now(), randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) })
const codeOf = (err: unknown) => (err instanceof HttpError ? err.code : String(err))

describe('typed routes', () => {
  it('parse requests strictly: unknown keys, bad path params and bad types are 400s naming the path', async () => {
    const s = server()
    const p = await s.join()
    const res = await s.request('PUT', '/v1/me/leaderboard', { token: p.token, body: { optIn: true, extra: 1 } })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: { message: string } }).error.message, /\$\.extra: unknown key/)
    assert.equal((await s.request('PUT', '/v1/me/leaderboard', { token: p.token, body: { optIn: 'yes' } })).status, 400)
    assert.equal((await s.request('GET', '/v1/season/0')).status, 400)
    assert.equal((await s.request('GET', '/v1/season/abc')).status, 400)
    assert.equal((await s.request('GET', '/v1/auth/poll/not*an*id')).status, 400)
  })

  it('merge path parameters and body fields into one request object', () => {
    const req = requestOf({ params: { battleId: 'b1' }, body: { inputs: [2, 5] } }, 'finishBattle')
    assert.deepEqual(req, { inputs: [2, 5], battleId: 'b1' })
    assert.deepEqual(requestOf({ params: { season: '12' }, body: undefined }, 'season'), { season: 12 })
    assert.throws(() => requestOf({ params: {}, body: { inputs: [5, 2] } }, 'finishBattle'), (e: unknown) => codeOf(e) === 'bad_request')
  })

  it('refuse to put a public operation behind a session or the other way round', () => {
    assert.throws(() => server({ register: api => apiRoute(api, 'world', async () => { throw new Error() }) }), /public/)
  })
})

describe('the version handshake', () => {
  it('serves GET /v1/version to anyone, cacheable for an hour', async () => {
    const s = server()
    const res = await s.request('GET', '/v1/version', { client: null })
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600')
    const v = exact('version', await res.json())
    assert.deepEqual({ ...v, features: [] }, {
      api: 1, server: '0.1.0', rules: RULES_VERSION, generator: GENERATOR_VERSION, minClient: '0.1.0', latestClient: '0.1.0', features: [],
    })
    assert.deepEqual(v.features, [...FEATURES])
  })

  it('answers 426 upgrade_required only to a well-formed client below minClient, and never on /v1/version', async () => {
    const s = server()
    for (const client of ['0.0.9', '0.0.99-beta']) {
      const res = await s.request('GET', '/v1/world', { client })
      assert.equal(res.status, 426)
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'upgrade_required')
      assert.equal((await s.request('GET', '/v1/version', { client })).status, 200)
    }
    for (const client of [null, '0.1.0', '0.2.0', '1.0.0', 'garbage', '0.0.9.9']) {
      assert.equal((await s.request('GET', '/v1/world', { client })).status, 200, String(client))
    }
    assert.equal(tooOld('0.9.12', '0.10.0'), true)
    assert.equal(tooOld('0.10.0', '0.9.12'), false)
    assert.equal(tooOld('1.2.3', '1.2.3'), false)
    // a pre-release sorts before its release, as the mod's own compareSemver has it
    assert.equal(tooOld('0.2.0-beta.1', '0.2.0'), true)
    assert.equal(tooOld('0.2.0', '0.2.0-beta.1'), false)
    assert.equal(tooOld('0.2.0-beta.1', '0.2.0-beta.2'), true)
    assert.equal(tooOld('0.2.0-beta.2', '0.2.0-beta.2'), false)
    assert.equal(tooOld('0.2.1-beta.1', '0.2.0'), false)
  })
})

describe('the world and seasons', () => {
  it('GET /v1/world is the date-driven world plus roughly how many players were seen since yesterday', async () => {
    const s = server()
    await s.join()
    await s.join()
    const res = await s.request('GET', '/v1/world')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
    assert.deepEqual(exact('world', await res.json()), { ...worldOf(T0), players: 0 }, 'a handful is "a few": nobody can tell who came by')
    const day = utcDay(T0)
    await s.db.batch(Array.from({ length: 120 }, (_, i) =>
      stmt('INSERT INTO players (id, handle, joined, last_seen, season) VALUES (?, ?, ?, ?, 1)', `w${i}`, `calm-wren-${1000 + i}`, day, day)))
    assert.equal((await s.call('world')).players, 100)
    s.tick(3 * DAY)
    assert.equal((await s.call('world')).players, 0)
    assert.deepEqual([0, 49, 50, 99, 100, 199, 200, 499, 500, 999, 1000, 23_456].map(roughCount), [0, 0, 50, 50, 100, 100, 200, 200, 500, 500, 1000, 20_000])
  })

  it('GET /v1/season/:n serves the frozen species for good, and never a season still to come', async () => {
    const s = server()
    const res = await s.request('GET', '/v1/season/1')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const season = exact('season', await res.json())
    assert.equal(season.generator, GENERATOR_VERSION)
    assert.deepEqual(season.species, JSON.parse(JSON.stringify(seasonSpecies(1))))
    const row = (await s.db.get<{ generator: number; species_json: string }>('SELECT generator, species_json FROM seasons WHERE season = 1'))!
    assert.deepEqual(JSON.parse(row.species_json), season.species)
    assert.equal((await s.request('GET', '/v1/season/2')).status, 404)
    s.set(seasonStart(2))
    assert.equal((await s.request('GET', '/v1/season/2')).status, 200)
  })

  it('mints from the stored species, not from whatever the generator would make now', async () => {
    // a far season nothing else in this process touches: its stored form differs from a fresh generation
    const SEASON = 77
    const s = server({ now: seasonStart(SEASON) + HOUR })
    const fresh = JSON.parse(JSON.stringify(seasonSpecies(SEASON))) as Species[]
    const stored = fresh.map(sp => ({ ...sp, base: { hp: 99, atk: 9, def: 9, spd: 9 } }))
    await s.db.batch([stmt('INSERT INTO seasons (season, generator, species_json) VALUES (?, 1, ?)', SEASON, JSON.stringify(stored))])
    const p = await s.join()
    // Glass Heart (-15% hp) would blur the bound below, so read a starter without it
    const starter = (await cardsOf(s.db, p.id)).find(c => !c.card.traits.includes('glassHeart'))
    assert.equal(starter!.card.season, SEASON)
    // hp 99 base x gene x level 3 (1.14) is far above any generated base of 20..64
    assert.ok(starter!.card.stats.hp > 99 * 0.88 * 1.14 - 1, `stats came from the stored base (${starter!.card.stats.hp})`)
    assert.equal((await s.call('season', { season: SEASON })).generator, 1)
  })
})

describe('joining', () => {
  it('needs nothing but the proof of work and a family: starters set as the team, welcome packs, sparks', async () => {
    const s = server()
    const p = await s.join('opus')
    const me = p.me.player
    assert.match(me.handle, /^[a-z]+-[a-z]+-\d{2,4}$/)
    assert.ok(HANDLE_RE.test(me.handle) && !isBlocked(me.handle))
    assert.deepEqual(
      { sparks: me.sparks, rating: me.rating, league: me.league, battles: me.battles, canTrade: me.canTrade, streak: me.streak, joinedDay: me.joinedDay },
      { sparks: 100, rating: 1000, league: 'Pebble', battles: 0, canTrade: false, streak: 0, joinedDay: '2026-10-02' },
    )
    assert.equal(me.nextWildAt, 0, 'the first encounter may come at once')
    assert.equal(me.nextChargeAt, T0 + ECONOMY.packs.chargeSpacingMs, 'the first charge waits like any other')
    const cards = (await cardsOf(s.db, p.id)).map(c => c.card)
    assert.equal(cards.length, 3)
    assert.deepEqual(me.team, cards.map(c => c.id).sort((a, b) => me.team.indexOf(a) - me.team.indexOf(b)))
    const families = cards.map(c => c.family).sort()
    assert.ok(FAMILIES.some(f => JSON.stringify(families) === JSON.stringify([f, beats(f), beatenBy(f)].sort())), 'a family, the one it beats and the one that beats it')
    for (const c of cards) {
      assert.deepEqual([c.rarity, c.level, c.xp, c.stage, c.bound, c.origin], ['common', 3, 100, 1, true, 'starter'])
      assert.ok(ID_RE.test(c.id) && c.id.length === 26)
    }
    assert.deepEqual(new Set(me.seen), new Set(cards.map(c => c.species)))
    assert.deepEqual(p.me.packs.map(k => k.source), ['welcome', 'welcome'])
    assert.ok(p.me.packs.some(k => k.family === 'opus'))
    const locks = await s.db.all<{ lock_until: number }>('SELECT lock_until FROM packs WHERE owner_id = ?', p.id)
    // 7 days from the join day, to a midnight: no hour of joining is kept (SPEC 20.4)
    assert.deepEqual(locks.map(l => l.lock_until), [Date.UTC(2026, 9, 9), Date.UTC(2026, 9, 9)])
  })

  it('makes the public starter team from a family of its own, never the one the player joined with (SPEC 20.2)', async () => {
    const s = server()
    const leads = new Set<string>()
    const missing = new Set<string>()
    for (let i = 0; i < 24; i++) {
      const p = await s.join('opus')
      const team = (await s.call('profile', { handle: p.me.player.handle }, p.token)).team
      leads.add(team[0]!.family)
      missing.add(FAMILIES.find(f => !team.some(c => c.family === f))!)
    }
    assert.ok(leads.size > 1, 'the lead is not the joining family')
    assert.ok(missing.size > 1, 'nor is the family the team lacks a tell')
  })

  it('keeps only the hash of the token, nowhere else', async () => {
    const s = server()
    const p = await s.join()
    const tables = (await s.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(r => r.name)
    for (const t of tables) {
      const rows = await s.db.all<Record<string, unknown>>(`SELECT * FROM ${t}`)
      assert.ok(!JSON.stringify(rows).includes(p.token), `${t} holds the token`)
    }
    assert.equal((await counts(s.db, ['sessions'])).sessions, 1)
  })

  it('gives the first card of a species anyone obtained the First Discovered stamp, once', async () => {
    const s = server()
    const players: Player[] = []
    for (let i = 0; i < 6; i++) players.push(await s.join(['haiku', 'sonnet', 'opus', 'fable'][i % 4] as never))
    const firsts = await s.db.all<{ species: string; card_id: string; player_id: string }>('SELECT species, card_id, player_id FROM firsts')
    const stamped = await s.db.all<{ id: string; species: string; owner_id: string }>('SELECT id, species, owner_id FROM cards WHERE first_find = 1')
    assert.equal(new Set(firsts.map(f => f.species)).size, firsts.length)
    assert.deepEqual(stamped.map(c => c.id).sort(), firsts.map(f => f.card_id).sort())
    const species = await s.db.all<{ species: string }>('SELECT DISTINCT species FROM cards')
    assert.equal(firsts.length, species.length)
  })

  it('refuses malformed joins, spent or wrong proofs, and too many joins from one address', async () => {
    const s = server()
    const { challenge, difficulty } = await s.call('challenge')
    const join = (body: unknown, ip = '192.0.2.7') => s.request('POST', '/v1/join', { body, ip })
    assert.equal((await join({ challenge, nonce: '0', family: 'dragon' })).status, 400)
    assert.equal((await join({ challenge, nonce: '0', family: 'opus', handle: 'me' })).status, 400)
    let wrong = 0
    while (proofBits(challenge, `x${wrong}`) >= difficulty) wrong++
    assert.equal((await join({ challenge, nonce: `x${wrong}`, family: 'opus' })).status, 403) // not a proof, and now spent
    assert.equal((await join({ challenge, nonce: '0', family: 'opus' })).status, 410)
    const statuses = []
    for (let i = 0; i < 6; i++) {
      const { challenge: c, difficulty } = await s.call('challenge', {}, null, '192.0.2.9')
      const { solveProofOfWork } = await import('../../plugin/hooks/core/sha256.ts')
      statuses.push((await join({ challenge: c, nonce: solveProofOfWork(c, difficulty), family: 'haiku' }, '192.0.2.9')).status)
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429])
  })
})

describe('GET /v1/me and touch', () => {
  it('needs a live session and answers exactly the documented shape', async () => {
    const s = server()
    const p = await s.join()
    for (const token of [null, 'f'.repeat(64), 'nope']) assert.equal((await s.request('GET', '/v1/me', { token })).status, 401)
    const me = await p.call('me')
    assert.equal(me.now, T0)
    assert.deepEqual(me.offers, { incoming: [], outgoing: [] })
    assert.deepEqual(me.gifts, [])
  })

  it('pays the daily hello once per UTC day and records last_seen as a day', async () => {
    const s = server()
    const p = await s.join()
    assert.equal((await p.call('me')).player.sparks, 100, 'joining pays the first day')
    s.tick(DAY)
    assert.equal((await p.call('me')).player.sparks, 110)
    assert.equal((await p.call('me')).player.sparks, 110)
    const row = await p.row()
    assert.deepEqual([row.last_seen, row.hello_day], ['2026-10-03', '2026-10-03'])
    const session = await s.db.get<{ last_used_day: string }>('SELECT last_used_day FROM sessions WHERE player_id = ?', p.id)
    assert.equal(session!.last_used_day, '2026-10-03')
  })

  it('skips touch on routes that say touch: false', async () => {
    const s = server()
    const p = await s.join()
    s.tick(DAY)
    await p.call('devices')
    assert.equal((await p.row()).sparks, 100)
    await p.call('me')
    assert.equal((await p.row()).sparks, 110)
  })

  it('turns the season once: league packs, a foil legendary for Star, the soft reset and a notice', async () => {
    const s = server()
    const low = await s.join()
    const star = await s.join()
    await s.db.batch([stmt('UPDATE players SET rating = 1720 WHERE id = ?', star.id)])
    s.set(seasonStart(2) + HOUR)
    const a = await low.call('me')
    assert.equal(a.packs.filter(k => k.source === 'season').length, 1)
    assert.equal(a.player.rating, 1000)
    assert.match(a.notices[0]!.text, /^Season 1 ended in Pebble: 1 reward pack!$/)
    assert.equal(a.notices[0]!.kind, 'season-end')
    const b = await star.call('me')
    assert.equal(b.packs.filter(k => k.source === 'season').length, 5)
    assert.equal(b.player.rating, 1360)
    const legend = (await cardsOf(s.db, star.id)).map(c => c.card).find(c => c.origin === 'season')!
    assert.deepEqual([legend.rarity, legend.foil, legend.stage, legend.season], ['legendary', true, 3, 2])
    assert.match(b.notices[0]!.text, /Star: 5 reward packs and a foil legendary!/)
    const again = await star.call('me')
    assert.equal(again.packs.filter(k => k.source === 'season').length, 5)
    assert.equal((await star.row()).season, 2)
  })

  it('re-runs the request when a touch step loses a race', async () => {
    let writes = 0
    const s = server({
      register: api => api.onTouch(async (ctx: PlayerCtx) => {
        if (writes++ === 0) await ctx.db.batch([stmt('UPDATE players SET version = version + 1 WHERE id = ?', ctx.player.id)])
      }),
    })
    const p = await s.join()
    s.tick(DAY)
    writes = 0
    await p.call('me') // the hello's batch meets a stale version once, then goes through
    assert.equal((await p.row()).sparks, 110)
  })
})

describe('account routes', () => {
  it('reroll the handle once a week, keeping the old one out of circulation for 30 days', async () => {
    const s = server()
    const p = await s.join()
    const old = p.me.player.handle
    const first = await p.call('rerollHandle', {})
    assert.notEqual(first.handle, old)
    assert.equal(first.handleRerollFrom, '2026-10-09')
    assert.equal((await p.call('me')).player.handle, first.handle)
    assert.deepEqual(await s.db.get('SELECT until FROM retired_handles WHERE handle = ?', old), { until: '2026-11-01' })
    const early = await p.fails('rerollHandle', {})
    assert.equal(early.code, 'rate_limited')
    assert.ok(Number(early.headers.get('retry-after')) > 6 * 24 * 3600)
    s.set(Date.UTC(2026, 9, 9))
    assert.ok((await p.call('rerollHandle', {})).handle)
  })

  it('opt in to the leaderboard and back out', async () => {
    const s = server()
    const p = await s.join()
    assert.deepEqual(await p.call('setLeaderboard', { optIn: true }), { leaderboard: true })
    assert.equal((await p.call('me')).player.leaderboard, true)
    assert.deepEqual(await p.call('setLeaderboard', { optIn: false }), { leaderboard: false })
    assert.equal((await p.row()).leaderboard, 0)
  })
})

describe('DELETE /v1/me', () => {
  it("removes everything that is the player's, keeps what others need, and frees the handle 30 days on", async () => {
    const s = server()
    const gone = await s.join()
    const other = await s.join()
    const [theirs, kept] = await cardsOf(s.db, other.id)
    const [mine] = await cardsOf(s.db, gone.id)
    const d = utcDay(T0)
    await s.db.batch([
      stmt(`UPDATE cards SET state = 'escrow', escrow_ref = 'o-in' WHERE id = ?`, theirs!.card.id),
      stmt(`INSERT INTO offers (id, from_id, to_id, from_handle, to_handle, give, get, created, expires_at) VALUES ('o-in', ?, ?, ?, ?, ?, '[]', ?, ?)`,
        other.id, gone.id, other.me.player.handle, gone.me.player.handle, JSON.stringify([theirs!.card.id]), d, T0 + DAY),
      stmt(`INSERT INTO offers (id, from_id, to_id, from_handle, to_handle, give, get, created, expires_at) VALUES ('o-out', ?, ?, ?, ?, '[]', '[]', ?, ?)`,
        gone.id, other.id, gone.me.player.handle, other.me.player.handle, d, T0 + DAY),
      stmt(`INSERT INTO gifts (code, giver_id, card_id, created, expires) VALUES ('quiet-otter-lamp-4821', ?, ?, ?, ?)`, gone.id, mine!.card.id, d, d),
      stmt(`INSERT INTO gifts (code, giver_id, card_id, state, created, expires, claimed_by, bonus) VALUES ('brave-wren-kite-5678', ?, 'x', 'claimed', ?, ?, ?, 1)`, other.id, d, d, gone.id),
      stmt(`INSERT INTO battles (id, attacker_id, defender_id, kind, setup, opponent, started_at) VALUES ('b1', ?, ?, 'duel', '{}', '{}', ?)`, gone.id, other.id, T0),
      stmt(`INSERT INTO battles (id, attacker_id, defender_id, kind, setup, opponent, started_at) VALUES ('b2', ?, ?, 'duel', '{}', '{}', ?)`, other.id, gone.id, T0),
      stmt(`INSERT INTO notices (id, player_id, day, kind, text, other_id, revenge_until) VALUES ('n1', ?, ?, 'defense-loss', 'x', ?, ?)`, other.id, d, gone.id, T0 + DAY),
      stmt(`INSERT INTO wishes (player_id, species, pos) VALUES (?, 's1-opus-0', 0)`, gone.id),
      stmt(`INSERT INTO fusions (player_id, form, day) VALUES (?, '{}', ?)`, gone.id, d),
      stmt(`INSERT INTO mythics (card_id, name, finder_id, handle, day) VALUES ('m1', 'Hollowmere Duskwing', ?, ?, ?)`, gone.id, gone.me.player.handle, d),
      // a Mythic the leaver found and traded away
      stmt('UPDATE cards SET form = ? WHERE id = ?', JSON.stringify({ kind: 'mythic', discoveredBy: gone.me.player.handle }), kept!.card.id),
      stmt(`INSERT INTO mythics (card_id, name, finder_id, handle, day) VALUES (?, 'Glimmer Hollow', ?, ?, ?)`, kept!.card.id, gone.id, gone.me.player.handle, d),
      stmt(`INSERT INTO trader_uses (player_id, day, deal) VALUES (?, ?, 0)`, gone.id, d),
      stmt(`INSERT INTO redemptions (drop_id, player_id, day) VALUES ('d1', ?, ?)`, gone.id, d),
      stmt(`INSERT INTO passkeys (id, player_id, credential_id, user_id, alg, public_key, created_day) VALUES ('k1', ?, 'cred', 'u', -7, '{}', ?)`, gone.id, d),
    ])
    await gone.call('passkeyStart', {})
    assert.deepEqual(await gone.call('deleteMe'), { deleted: true })
    assert.equal((await s.request('GET', '/v1/me', { token: gone.token })).status, 401)
    const left = async (sql: string, ...params: (string | number)[]) => (await s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${sql}`, ...params))!.n
    for (const t of ['players', 'sessions', 'passkeys', 'auth_polls', 'cards', 'packs', 'wishes', 'album', 'fusions', 'trader_uses', 'redemptions']) {
      const col = t === 'cards' || t === 'packs' ? 'owner_id' : t === 'players' ? 'id' : 'player_id'
      assert.equal(await left(`${t} WHERE ${col} = ?`, gone.id), 0, t)
    }
    assert.equal(await left('offers'), 0)
    assert.equal(await left(`gifts WHERE giver_id = ?`, gone.id), 0)
    assert.deepEqual(await s.db.get(`SELECT claimed_by, bonus FROM gifts WHERE code = 'brave-wren-kite-5678'`), { claimed_by: null, bonus: 0 })
    assert.deepEqual((await s.db.all<{ id: string }>('SELECT id FROM battles')).map(b => b.id), ['b2'])
    assert.equal((await s.db.get<{ defender_id: string | null }>(`SELECT defender_id FROM battles WHERE id = 'b2'`))!.defender_id, null)
    assert.deepEqual(await s.db.get(`SELECT other_id, revenge_until FROM notices WHERE id = 'n1'`), { other_id: null, revenge_until: null })
    assert.equal(await left('firsts WHERE player_id = ?', gone.id), 0)
    assert.ok((await left('firsts WHERE player_id IS NULL')) > 0, 'first discoveries stay, so nobody else becomes first')
    assert.deepEqual(await s.db.all(`SELECT finder_id, handle FROM mythics`), [{ finder_id: null, handle: null }, { finder_id: null, handle: null }])
    assert.equal((await s.db.get<{ by: string | null }>(`SELECT json_extract(form, '$.discoveredBy') AS by FROM cards WHERE id = ?`, kept!.card.id))!.by, null, 'a Mythic that changed hands no longer names its finder')
    assert.deepEqual(await s.db.get('SELECT until FROM retired_handles WHERE handle = ?', gone.me.player.handle), { until: '2026-11-01' })
    // the other player's card held for the offer came back, with word of it
    const back = await ownCard(s.db, other.id, theirs!.card.id)
    assert.deepEqual([back.card.state, back.escrowRef], ['owned', null])
    const news = await other.call('me')
    // without the leaver's handle: a deleted account leaves nothing that names it (SPEC 20.7)
    assert.ok(news.notices.some(n => n.kind === 'offer-declined' && !n.text.includes(gone.me.player.handle) && n.handle === undefined))
    // two of their cards changed: the one home from the offer, and the Mythic's stamp
    assert.equal(news.player.cardsVersion, other.me.player.cardsVersion + 2)
  })
})

describe('mintCards', () => {
  it('computes stats on the server whatever the card claims, and stores power', async () => {
    const s = server()
    const p = await s.join()
    const rolled = mintFor('sonnet', 'rare', rngFromSeed('x'), T0, 'craft')
    const { cards, stmts } = await mintCards(env(s), p.id, [{ ...rolled, stats: { hp: 999, atk: 999, def: 999, spd: 999 } }])
    await s.db.batch(stmts)
    assert.deepEqual(cards[0]!.stats, rolled.stats)
    const row = (await s.db.get<{ stats: string; power: number }>('SELECT stats, power FROM cards WHERE id = ?', cards[0]!.id))!
    assert.deepEqual(JSON.parse(row.stats), rolled.stats)
    assert.equal(row.power, rolled.stats.hp + 2 * rolled.stats.atk + 2 * rolled.stats.def + rolled.stats.spd)
    assert.equal((await p.call('me')).player.cardsVersion, p.me.player.cardsVersion + 1)
  })

  it("logs the player's own fusions, lists caught Mythics, and applies locks and binding", async () => {
    const s = server()
    const p = await s.join()
    const [a, b] = (await cardsOf(s.db, p.id)).map(c => c.card)
    const hybrid = fuse(a!, b!, rngFromSeed('f'), T0)
    const myth = cardFromBattleCard({ ...generateMythic({ seed: 'abc', dna: 1, now: T0 }), id: 'wild-0' } as Card, 'catch', T0, { discoveredBy: p.me.player.handle })
    const { cards, stmts } = await mintCards(env(s), p.id, [hybrid, myth], { lockedUntil: T0 + DAY, bound: true })
    await s.db.batch(stmts)
    assert.deepEqual(cards.map(c => [c.lockedUntil, c.bound]), [[T0 + DAY, true], [T0 + DAY, true]])
    assert.equal((await s.db.all('SELECT * FROM fusions WHERE player_id = ?', p.id)).length, 1)
    assert.deepEqual(await s.db.get('SELECT name, finder_id FROM mythics WHERE card_id = ?', cards[1]!.id), { name: myth.form!.names[0], finder_id: p.id })
    assert.equal(cards[1]!.form!.discoveredBy, p.me.player.handle)
  })

  it('makes a lost race for a first discovery a Conflict, so the handler re-runs', async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    const fresh = starterTeam('haiku', rngFromSeed('same'), T0).map(c => ({ ...c, species: 's1-fable-8', family: 'fable' as const, rarity: 'legendary' as const, stage: 3 as const }))
    const one = await mintCards(env(s), p.id, [fresh[0]!])
    const two = await mintCards(env(s), q.id, [fresh[1]!])
    assert.equal(one.cards[0]!.firstFind, true)
    assert.equal(two.cards[0]!.firstFind, true)
    await s.db.batch(one.stmts)
    await assert.rejects(s.db.batch(two.stmts), (e: unknown) => e instanceof Conflict)
    const retry = await mintCards(env(s), q.id, [fresh[1]!])
    assert.equal(retry.cards[0]!.firstFind, undefined)
  })

  it('refuses a card the client reader would refuse', async () => {
    const s = server()
    const p = await s.join()
    const bad = { ...mintFor('opus', 'common', rngFromSeed('b'), T0, 'craft'), traits: [] }
    await assert.rejects(mintCards(env(s), p.id, [bad]), /traits/)
  })
})

describe('card helpers', () => {
  it("load only the caller's cards, guard their version and save progress with fresh stats", async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    const [c] = await cardsOf(s.db, p.id)
    await assert.rejects(ownCard(s.db, q.id, c!.card.id), (e: unknown) => codeOf(e) === 'not_found')
    await assert.rejects(ownCards(s.db, p.id, [c!.card.id, 'nope']), (e: unknown) => codeOf(e) === 'not_found')
    const levelled = { ...c!.card, level: 4, stage: 2 as const, raisedIn: 'opus' as const }
    await s.db.batch([cardGuard(c!), saveCard(c!, levelled, { arena: { ...c!.arena, opus: 3 } })])
    const after = await ownCard(s.db, p.id, c!.card.id)
    assert.deepEqual([after.version, after.card.stage, after.card.raisedIn, after.arena.opus], [1, 2, 'opus', 3])
    assert.ok(after.card.stats.hp > c!.card.stats.hp)
    await assert.rejects(s.db.batch([cardGuard(c!), saveCard(c!, levelled)]), (e: unknown) => e instanceof Conflict)
  })

  it("show offers as public battle cards and gifts with the giver's own card", async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    const [mine] = await cardsOf(s.db, p.id)
    const [theirs] = await cardsOf(s.db, q.id)
    const d = utcDay(T0)
    await s.db.batch([
      stmt(`INSERT INTO offers (id, from_id, to_id, from_handle, to_handle, give, get, created, expires_at) VALUES ('o1', ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, q.id, p.me.player.handle, q.me.player.handle, JSON.stringify([mine!.card.id]), JSON.stringify([theirs!.card.id, 'gone']), d, T0 + 3 * DAY),
      stmt(`INSERT INTO gifts (code, giver_id, card_id, created, expires) VALUES ('quiet-otter-lamp-4821', ?, ?, ?, '2026-10-16')`, p.id, mine!.card.id, d),
    ])
    const [view] = await offerViews(s.db, await s.db.all('SELECT * FROM offers'))
    assert.deepEqual([view!.from, view!.to, view!.give.length, view!.get.length], [p.me.player.handle, q.me.player.handle, 1, 1])
    for (const c of [...view!.give, ...view!.get]) for (const k of ['mintedAt', 'lockedUntil', 'tiredUntil', 'origin', 'state', 'bound', 'xp', 'raisedIn']) assert.ok(!(k in c), k)
    assert.equal(view!.createdAt, Date.UTC(2026, 9, 2))
    const me = await p.call('me')
    assert.equal(me.offers.outgoing.length, 1)
    assert.deepEqual(await giftViews(s.db, await s.db.all('SELECT * FROM gifts')), [{
      code: 'quiet-otter-lamp-4821', card: mine!.card, createdAt: Date.UTC(2026, 9, 2), expiresAt: Date.UTC(2026, 9, 16),
    }])
    assert.equal(me.gifts[0]!.code, 'quiet-otter-lamp-4821')
  })
})

describe('the player row', () => {
  it('commit guards the version the handler read, and setPlayer takes only column names', async () => {
    const s = server()
    const p = await s.join()
    const row = await p.row()
    await commit({ db: s.db, player: row }, [setPlayer(row.id, { sparks: 50 })])
    assert.equal((await p.row()).version, row.version + 1)
    await assert.rejects(commit({ db: s.db, player: row }, [setPlayer(row.id, { sparks: 1 })]), (e: unknown) => e instanceof Conflict)
    assert.throws(() => setPlayer(row.id, { 'sparks = 0, rating': 1 }), /bad columns/)
    assert.equal((await p.row()).sparks, 50)
  })

  it('draws handles and gift codes only from plain, unblocked words', async () => {
    const { ADJECTIVES, CREATURES, GIFT_WORDS } = await import('../../server/src/game/words.ts')
    for (const w of [...ADJECTIVES, ...CREATURES, ...GIFT_WORDS]) {
      assert.match(w, /^[a-z]{2,12}$/, w)
      assert.equal(isBlocked(w), false, w)
    }
    assert.ok(GIFT_WORDS.length ** 3 * 10_000 >= 2 ** 43, 'gift codes carry about 44 bits')
  })

  it('makes random ids, codes and numbers of the documented shapes', () => {
    const r = { randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }
    assert.equal(base32(new Uint8Array([0xff, 0x00, 0x10])), '74aba')
    for (let i = 0; i < 50; i++) {
      assert.match(newId(r), /^[a-z2-7]{26}$/)
      assert.match(newGiftCode(r), GIFT_CODE_RE)
      const n = randomInt(r, 7)
      assert.ok(n >= 0 && n < 7)
    }
  })
})

describe('pacing', () => {
  const at = (over: Partial<PlayerRow>) => ({ id: 'p', last_wild_at: 0, last_duel_at: 0, last_charge_at: 0, charges: '[]', joined: '2026-10-02', battles: 0, ...over }) as PlayerRow

  it('spaces wild starts 8 minutes apart, with a Retry-After', () => {
    assert.doesNotThrow(() => checkWildStart(at({}), T0))
    assert.throws(() => checkWildStart(at({ last_wild_at: T0 }), T0 + 7 * MINUTE), (e: unknown) =>
      e instanceof HttpError && e.code === 'rate_limited' && e.headers['Retry-After'] === '60')
    assert.doesNotThrow(() => checkWildStart(at({ last_wild_at: T0 }), T0 + 8 * MINUTE))
  })

  it('spaces charges 45 minutes, 90 beyond 16 in a day, and stops at a full bank', () => {
    let p = at({})
    let t = T0
    for (let i = 0; i < 16; i++) {
      checkCharge(p, t, 0)
      const s = markCharge(p, t)
      p = { ...p, last_charge_at: t, charges: s.params[1] as string }
      t += 45 * MINUTE
    }
    assert.equal(recentCharges(p, t).length, 16)
    assert.equal(nextChargeAt(p, t), p.last_charge_at + 90 * MINUTE)
    assert.throws(() => checkCharge(p, t, 0), (e: unknown) => codeOf(e) === 'rate_limited')
    assert.throws(() => checkCharge(at({}), T0, ECONOMY.packs.bank), (e: unknown) => codeOf(e) === 'cap_reached')
    assert.equal(recentCharges(p, t + DAY).length, 0)
  })

  it('opens trading after 3 calendar days and 10 finished battles', () => {
    assert.equal(trusted(at({ battles: 10 }), Date.UTC(2026, 9, 4, 23)), false)
    assert.equal(trusted(at({ battles: 9 }), Date.UTC(2026, 9, 5)), false)
    assert.equal(trusted(at({ battles: 10 }), Date.UTC(2026, 9, 5)), true)
  })

  it('counts finished battles and the distinct days they fall on', async () => {
    const s = server()
    const p = await s.join()
    for (const t of [T0, T0 + HOUR, T0 + DAY]) await s.db.batch([battleFinished(p.id, t)])
    const row = await p.row()
    assert.deepEqual([row.battles, row.battle_days, row.battle_day], [3, 2, '2026-10-03'])
  })

  it('counts the pair limit over settled duels in the last 24 hours, either way round', async () => {
    const s = server()
    const duel = (id: string, a: string, d: string, startedAt: number, state = 'settled') =>
      stmt(`INSERT INTO battles (id, attacker_id, defender_id, kind, state, setup, opponent, started_at) VALUES (?, ?, ?, 'duel', ?, '{}', '{}', ?)`, id, a, d, state, startedAt)
    await s.db.batch([duel('1', 'a', 'b', T0 - HOUR), duel('2', 'b', 'a', T0 - 2 * HOUR), duel('3', 'a', 'b', T0 - 25 * HOUR), duel('4', 'a', 'b', T0, 'open'), duel('5', 'a', 'c', T0)])
    assert.equal(await pairDuels(s.db, 'a', 'b', T0), 2)
    assert.equal(await pairDuels(s.db, 'b', 'a', T0), 2)
  })
})

describe('notices', () => {
  it("carry a day, never a time, newest first, with the other player's current handle", async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    const e = env(s)
    await s.db.batch([
      notice(e, p.id, 'defense-win', 'first'),
      notice({ ...e, now: T0 + DAY }, p.id, 'defense-loss', 'second \u001b[31mred\u001b[0m', { other: q.id, revengeUntil: T0 + 2 * DAY }),
    ])
    const list = await noticesOf(s.db, p.id)
    assert.deepEqual(list.map(n => [n.day, n.kind, n.text, n.handle]), [
      ['2026-10-03', 'defense-loss', 'second red', q.me.player.handle],
      ['2026-10-02', 'defense-win', 'first', undefined],
    ])
    assert.ok(list.every(n => !('at' in n)))
  })
})

describe('retention', () => {
  it('sweeps expired sign-ins and sessions unused for 180 days, and keeps live ones', async () => {
    const s = server()
    const p = await s.join()
    const q = await s.join()
    await p.call('passkeyStart', {})
    await s.db.batch([stmt(`UPDATE sessions SET last_used_day = ? WHERE player_id = ?`, utcDay(T0 - 181 * DAY), q.id)])
    await sweepGame(s.db, T0)
    assert.deepEqual(await counts(s.db, ['auth_polls', 'sessions']), { auth_polls: 1, sessions: 1 })
    await sweepGame(s.db, T0 + 11 * MINUTE)
    assert.equal((await counts(s.db, ['auth_polls'])).auth_polls, 0)
    assert.equal((await s.request('GET', '/v1/me', { token: q.token })).status, 401)
  })

  it('freezes the current season, and the next one in its last hour, before any player needs it', async () => {
    const s = server({ now: seasonStart(3) - 30 * MINUTE })
    await s.app.sweep()
    assert.deepEqual((await s.db.all<{ season: number }>('SELECT season FROM seasons ORDER BY season')).map(r => r.season), [2, 3])
    assert.equal((await s.request('GET', '/v1/season/3')).status, 404, 'stored early, served only once it begins')
  })

  it('runs from app.sweep, which the Worker cron and the Node timer call', async () => {
    const s = server()
    await s.db.batch([stmt(`INSERT INTO notices (id, player_id, day, kind, text) VALUES ('old', 'p', '2026-08-01', 'notice', 'x')`)])
    await s.app.sweep()
    assert.equal((await counts(s.db, ['notices'])).notices, 0)
  })
})

describe('seasons in the database', () => {
  it('are generated once per database and then read back', async () => {
    const s = server()
    const first = await ensureSeason(s.db, 1)
    await s.db.batch([stmt(`UPDATE seasons SET generator = 99 WHERE season = 1`)])
    assert.equal((await ensureSeason(s.db, 1)).generator, first.generator, 'cached for the isolate')
    assert.equal(getSpecies('s1-opus-0')!.id, 's1-opus-0')
  })
})

describe('grantPack', () => {
  it('makes a pack row with its lock and binding, and refuses a made-up family', async () => {
    const s = server()
    const p = await s.join()
    const g = grantPack(env(s), p.id, 'fable', 'promo', { lockUntil: 5, bound: true })
    await s.db.batch([g.stmt])
    assert.deepEqual(await s.db.get('SELECT family, source, created, lock_until, bound FROM packs WHERE id = ?', g.pack.id),
      { family: 'fable', source: 'promo', created: '2026-10-02', lock_until: 5, bound: 1 })
    assert.throws(() => grantPack(env(s), p.id, 'dragon' as never, 'bonus'), /bad family/)
  })
})

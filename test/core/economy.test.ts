import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ECONOMY, canRerollHandle, canTrade, chargeSpacingMs, finishAfter, giftBonusDue, isRested, leagueOf, nextStreak, pairCounts,
  seasonEnd, streakPackDue,
} from '../../plugin/hooks/core/economy.ts'
import type { Streak } from '../../plugin/hooks/core/economy.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

test('no per-day quotas anywhere in the economy (SPEC section 24)', () => {
  const keys: string[] = []
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) { keys.push(path + k); walk(x, path + k + '.') }
  }
  walk(ECONOMY, '')
  const quotas = keys.filter(k => /perday|perweek|daycap|maxpacksper|bonuspacksper/i.test(k))
  assert.deepEqual(quotas, [])
  // the server's request limits live with the server alone; core keeps only what both sides read
  assert.deepEqual(Object.keys(ECONOMY.server).sort(), ['pollTtlMs', 'sessionIdleMs'])
  assert.deepEqual(ECONOMY.levels.evolveAt, [4, 8])
  assert.deepEqual(ECONOMY.stats.stageMult, [1, 1.15, 1.3])
  assert.equal(ECONOMY.packs.bank, 12)
  assert.equal(ECONOMY.trade.openOutgoing, 20)
  assert.equal(ECONOMY.gift.open, 10)
})

test('pacing: pack charge spacing doubles only beyond 16 charges a day; finish waits 1.5 s a round', () => {
  assert.equal(chargeSpacingMs(0), 45 * MIN)
  assert.equal(chargeSpacingMs(15), 45 * MIN)
  assert.equal(chargeSpacingMs(16), 90 * MIN)
  assert.equal(finishAfter(1000, 12), 1000 + 18_000)
})

test('pair limit, trust gate, gift bonus, streaks, handle rerolls and the rested bonus', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(pairCounts), [true, true, true, false, false])
  assert.equal(canTrade(0, 10, 3 * DAY), true)
  assert.equal(canTrade(0, 9, 3 * DAY), false)
  assert.equal(canTrade(0, 10, 3 * DAY - 1), false)
  assert.equal(giftBonusDue(5, 2), true)
  assert.equal(giftBonusDue(5, 1), false)
  assert.equal(giftBonusDue(4, 3), false)
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(streakPackDue), [false, false, false, true, false, false, true, true])
  assert.equal(canRerollHandle(0, 7 * DAY), true)
  assert.equal(canRerollHandle(0, 7 * DAY - 1), false)
  assert.equal(isRested(0, 4 * HOUR), true)
  assert.equal(isRested(HOUR, 4 * HOUR), false)
})

test('streaks: a loss ends one; a win adds only 8 minutes after the win that last did', () => {
  const gap = ECONOMY.streak.spacingMs
  assert.equal(gap, 8 * MIN)
  let s: Streak = { streak: 0, streakAt: 0 }
  const step = (win: boolean, now: number) => { const r = nextStreak(s, win, now); s = r; return [r.streak, r.pack] }
  assert.deepEqual(step(true, HOUR), [1, false])
  assert.deepEqual(step(true, HOUR + 2 * MIN), [1, false], 'too soon: the streak holds')
  assert.deepEqual(step(true, HOUR + gap), [2, false])
  assert.deepEqual(step(true, HOUR + 2 * gap), [3, true])
  assert.deepEqual(step(false, HOUR + 2 * gap + MIN), [0, false])
  assert.deepEqual(step(true, HOUR + 2 * gap + 2 * MIN), [1, false], 'a new streak starts on any win')
})

test('a day of duels every 2 minutes earns no more streak packs than presence charging does', () => {
  const day = (winRate: number, everyMs: number) => {
    const rng = rngFromSeed(`streaks/${winRate}/${everyMs}`)
    let s: Streak = { streak: 0, streakAt: 0 }, packs = 0
    for (let t = 0; t < DAY; t += everyMs) {
      const next = nextStreak(s, rng() < winRate, t)
      if (next.pack) packs++
      s = next
    }
    return packs
  }
  // a script that never loses: one pack per three spaced wins, at most
  assert.ok(day(1, 2 * MIN) <= Math.ceil(DAY / (ECONOMY.streak.every * ECONOMY.streak.spacingMs)), `${day(1, 2 * MIN)}`)
  // a Rival-sized team wins about half its duels; presence alone charges a pack every 45 minutes
  for (const every of [2 * MIN, ECONOMY.streak.spacingMs]) {
    const packs = day(0.55, every)
    assert.ok(packs <= DAY / ECONOMY.packs.chargeSpacingMs, `${packs} streak packs a day, duels every ${every / MIN} min`)
  }
})

test('leagues and the season-end grant', () => {
  assert.equal(leagueOf(0).name, 'Pebble')
  assert.equal(leagueOf(1100).name, 'Brook')
  assert.equal(leagueOf(1699).name, 'Peak')
  assert.equal(leagueOf(5000).name, 'Star')
  assert.deepEqual(seasonEnd(1400), { league: 'Grove', packs: 3, legendary: false, rating: 1200 })
  assert.deepEqual(seasonEnd(1800), { league: 'Star', packs: 5, legendary: true, rating: 1400 })
  assert.deepEqual(seasonEnd(600), { league: 'Pebble', packs: 1, legendary: false, rating: 800 })
})

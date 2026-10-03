import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAILY_RULES, DAY_MS, EPOCH_MS, RULE_INFO, SEASON_MS, catchChance, dailyRule, featuredSpecies, fusionCost, isShinyHour,
  isoWeek, roundLimit, seasonOf, seasonStart, shinyChance, utcDay, weeklyRoamer, worldOf,
} from '../../plugin/hooks/core/world.ts'
import { hashString } from '../../plugin/hooks/core/rng.ts'
import { getSpecies } from '../../plugin/hooks/core/species.ts'

test('season 1 starts 2026-10-01T00:00Z and lasts 28 days', () => {
  assert.equal(EPOCH_MS, Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(SEASON_MS, 28 * DAY_MS)
  assert.equal(seasonOf(EPOCH_MS), 1)
  assert.equal(seasonOf(EPOCH_MS + SEASON_MS - 1), 1)
  assert.equal(seasonOf(EPOCH_MS + SEASON_MS), 2)
  assert.equal(seasonOf(EPOCH_MS + 10 * SEASON_MS + 5), 11)
  assert.equal(seasonOf(EPOCH_MS - DAY_MS), 1)
  assert.equal(seasonStart(3), EPOCH_MS + 2 * SEASON_MS)
})

test('utcDay and isoWeek', () => {
  assert.equal(utcDay(Date.parse('2026-10-01T23:59:59Z')), '2026-10-01')
  assert.equal(utcDay(Date.parse('2026-10-02T00:00:00Z')), '2026-10-02')
  assert.equal(isoWeek(Date.parse('2026-10-01T12:00:00Z')), '2026-W40')
  assert.equal(isoWeek(Date.parse('2026-10-04T23:00:00Z')), '2026-W40')
  assert.equal(isoWeek(Date.parse('2026-10-05T00:00:00Z')), '2026-W41')
  assert.equal(isoWeek(Date.parse('2027-01-01T00:00:00Z')), '2026-W53')
  assert.equal(isoWeek(Date.parse('2021-01-03T00:00:00Z')), '2020-W53')
  assert.equal(isoWeek(Date.parse('2024-12-30T00:00:00Z')), '2025-W01')
  assert.equal(isoWeek(Date.parse('2026-01-01T00:00:00Z')), '2026-W01')
})

test('the daily rule comes from hashString("spinlings/day/" + date) and every rule turns up', () => {
  assert.equal(DAILY_RULES.length, 12)
  assert.deepEqual(Object.keys(RULE_INFO).sort(), [...DAILY_RULES].sort())
  const seen = new Set<string>()
  for (let d = 0; d < 400; d++) {
    const now = EPOCH_MS + d * DAY_MS + 5000
    const rule = dailyRule(now)
    assert.equal(rule, DAILY_RULES[hashString('spinlings/day/' + utcDay(now)) % 12])
    assert.equal(dailyRule(now + 3_600_000), rule)
    seen.add(rule)
  }
  assert.equal(seen.size, 12)
})

test('featured species is a regular species of the current season and changes by day', () => {
  const ids = new Set<string>()
  for (let d = 0; d < 60; d++) {
    const now = EPOCH_MS + d * DAY_MS
    const id = featuredSpecies(now)
    const s = getSpecies(id)!
    assert.equal(s.season, seasonOf(now))
    assert.equal(s.legendary, false)
    assert.equal(featuredSpecies(now + 80_000_000), id)
    ids.add(id)
  }
  assert.ok(ids.size > 20)
})

test('the weekly roamer is a legendary of the season and holds for the ISO week', () => {
  const monday = Date.parse('2026-10-05T00:00:00Z')
  const roamer = weeklyRoamer(monday)
  const s = getSpecies(roamer)!
  assert.equal(s.legendary, true)
  assert.equal(s.season, 1)
  for (let d = 0; d < 7; d++) assert.equal(weeklyRoamer(monday + d * DAY_MS + 1000), roamer)
  const roamers = new Set(Array.from({ length: 40 }, (_, w) => getSpecies(weeklyRoamer(EPOCH_MS + w * 7 * DAY_MS))!.family))
  assert.equal(roamers.size, 4)
})

test('shiny hour only on Shiny Hour days, 18:00 to 19:00 UTC', () => {
  let day = EPOCH_MS
  while (dailyRule(day) !== 'shinyHour') day += DAY_MS
  assert.equal(isShinyHour(day + 18 * 3_600_000), true)
  assert.equal(isShinyHour(day + 18 * 3_600_000 + 3_599_999), true)
  assert.equal(isShinyHour(day + 19 * 3_600_000), false)
  assert.equal(isShinyHour(day + 17 * 3_600_000 + 3_599_999), false)
  assert.equal(shinyChance(day + 18.5 * 3_600_000), 1 / 25)
  assert.equal(shinyChance(day + 12 * 3_600_000), 1 / 100)
  assert.equal(isShinyHour(day + 18 * 3_600_000, 'calm'), false)
})

test('rule-driven numbers', () => {
  assert.equal(roundLimit('calm'), 20)
  assert.equal(roundLimit('longDay'), 30)
  assert.equal(fusionCost('calm'), 40)
  assert.equal(fusionCost('fusionFair'), 20)
  assert.equal(catchChance('calm'), 0.6)
  assert.equal(catchChance('wildBloom'), 0.8)
})

test('worldOf bundles the day', () => {
  const now = Date.parse('2026-10-02T12:00:00Z')
  assert.deepEqual(worldOf(now), { day: '2026-10-02', season: 1, rule: dailyRule(now), featured: featuredSpecies(now), roamer: weeklyRoamer(now) })
})

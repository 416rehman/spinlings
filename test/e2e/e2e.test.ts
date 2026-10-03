// The two-player game, end to end over real HTTP (scripts/e2e.ts): the real Node server and the mod's
// own RemoteBackend, once over a node:sqlite file with the server's production proof-of-work
// difficulty, and once over Cloudflare D1 (wrangler's local workerd; skipped when it cannot start).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runE2E } from '../../scripts/e2e.ts'
import type { Report } from '../../scripts/e2e.ts'

const STEPS = [
  'version handshake',
  'join with proof of work',
  'open the welcome packs (firsts, foil)',
  'set the team',
  'wild battle with a Perfect press and a catch',
  'evolution and raised forms',
  'Rival duel when alone',
  'a second player joins',
  'duel vs player 2, a coarse defense notice and revenge',
  'play to the trust gate, charging packs on the way',
  'fusion',
  'recycle',
  'craft',
  'a Trader deal',
  'wishlist, for-trade and the board',
  'an offer, accepted, with the fee',
  'a gift, claimed by a newcomer, and the bonus pack',
  'a drop code hatches a foil promo egg',
  'leaderboard opt-in',
  'handle reroll',
  'delete the account, totally',
]

function check(report: Report, lines: string[]) {
  assert.deepEqual(report.steps.map(s => s.name), STEPS, lines.join('\n'))
  assert.ok(report.foil >= 1, 'a foil card was seen')
  assert.ok(report.requests > 100)
}

describe('end to end over HTTP', () => {
  it('on node:sqlite: two players (and a newcomer) play every feature, then one deletes their account', { timeout: 240_000 }, async () => {
    const lines: string[] = []
    check(await runE2E({ log: line => { lines.push(line) } }), lines)
  })

  it('on Cloudflare D1: the same game', { timeout: 300_000 }, async t => {
    const lines: string[] = []
    let report: Report
    try {
      report = await runE2E({ storage: 'd1', difficulty: 12, log: line => { lines.push(line) } })
    } catch (err) {
      if (err instanceof Error && err.message === 'wrangler could not start local D1') return t.skip(err.message)
      throw err
    }
    check(report, lines)
  })
})

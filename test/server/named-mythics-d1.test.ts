import { describe, it } from 'node:test'
import { localD1 } from './d1-helpers.ts'
import { namedEncounterLoss, namedEncounterRace } from './named-mythics-helpers.ts'

describe('named Mythics on real local D1', () => {
  it('reserves concurrent encounters atomically and preserves owner-free reservations through catch, deletion and sweep', { timeout: 60_000 }, async t => {
    const local = await localD1()
    if ('skip' in local) { t.skip(local.skip); return }
    await namedEncounterRace(local.db)
  })
  it('a lost encounter consumes its name permanently', { timeout: 60_000 }, async t => {
    const local = await localD1()
    if ('skip' in local) { t.skip(local.skip); return }
    await namedEncounterLoss(local.db)
  })
})

// Backward compatibility (SPEC 32): every supported mod version's recorded requests, replayed against the current
// server. For each fixtures/{version}/ flow a fresh in-process server (same clock, same seeds) answers the recorded
// requests in order, with placeholders filled from its own earlier answers, and must answer as that mod needs: the
// same status and error code, JSON under the mod's cap, readable by that version's own frozen reader, and every
// field the recorded answer had still there with the same type. Bodies need not match byte for byte.
// The fixtures come from scripts/compat-record.ts, once per release (docs/releasing.md).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLIENT_VERSION, compareSemver } from '../../plugin/hooks/client/remote.ts'
import { API_ROUTES } from '../../plugin/hooks/core/api.ts'
import { recordFlows } from '../../scripts/compat-record.ts'
import { MIN_CLIENT } from '../../server/src/app.ts'
import { replay } from './harness.ts'
import type { Exchange, Flow, Reader } from './harness.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const versions = readdirSync(FIXTURES, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(compareSemver)
const answered = (flows: readonly Flow[]) =>
  new Set(flows.flatMap(f => f.steps).filter((s): s is Exchange => 'op' in s && s.response.status < 300).map(s => s.op))

describe('compatibility fixtures', () => {
  it('the installed mod has its own (recorded in its release pull request)', () => {
    assert.ok(versions.includes(CLIENT_VERSION), `no test/compat/fixtures/${CLIENT_VERSION}: run node scripts/compat-record.ts`)
  })

  it('the recorder still plays every flow with the installed mod, and what it records replays', async () => {
    const flows = await recordFlows()
    const ok = answered(flows)
    assert.deepEqual(Object.keys(API_ROUTES).filter(op => !ok.has(op)), [], 'operations the recorder never answers')
    const reader = (await import(pathToFileURL(join(FIXTURES, CLIENT_VERSION, 'schemas.ts')).href)) as Reader
    for (const flow of flows) assert.deepEqual(await replay(flow, reader), [])
  })
})

for (const version of versions) {
  const dir = join(FIXTURES, version)
  const reader = (await import(pathToFileURL(join(dir, 'schemas.ts')).href)) as Reader
  const flows = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Flow)

  describe(`the ${version} mod against this server`, () => {
    it(`is still supported (MIN_CLIENT ${MIN_CLIENT})`, () => {
      assert.ok(compareSemver(version, MIN_CLIENT) >= 0, `this server refuses ${version}, so delete test/compat/fixtures/${version}`)
    })

    it('was recorded answering every operation it knows', () => {
      const ok = answered(flows)
      assert.deepEqual(Object.keys(reader.RESPONSE_SCHEMAS).filter(op => !ok.has(op)), [])
    })

    for (const flow of flows) {
      it(`${flow.flow}: ${flow.about}`, async () => {
        assert.equal(flow.client, version)
        const problems = await replay(flow, reader)
        assert.ok(problems.length === 0, `the ${version} mod would break:\n${problems.join('\n')}`)
      })
    }
  })
}

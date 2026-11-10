// Backward compatibility (SPEC 32): every supported mod version's recorded requests, replayed against the current
// server. For each fixtures/{version}/ flow a fresh in-process server (same clock, same seeds) answers the recorded
// requests in order, with placeholders filled from its own earlier answers, and must answer as that mod needs: the
// same status and error code, JSON under the mod's cap, readable by that version's own frozen reader, and every
// field the recorded answer had still there with the same type. Bodies need not match byte for byte.
// The fixtures come from scripts/compat-record.ts, once per release (docs/releasing.md), and until the installed
// version is tagged they must match what the recorder would write now.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLIENT_VERSION, compareSemver } from '../../plugin/hooks/client/remote.ts'
import { API_ROUTES } from '../../plugin/hooks/core/api.ts'
import type { ApiOp } from '../../plugin/hooks/core/api.ts'
import { parseResponse } from '../../plugin/hooks/core/schemas.ts'
import { frozenReader, recordFlows } from '../../scripts/compat-record.ts'
import { MIN_CLIENT } from '../../server/src/app.ts'
import { LOOSENED, optionalItemKeys, replay } from './harness.ts'
import type { Exchange, Flow, Loosened, Reader } from './harness.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const versions = readdirSync(FIXTURES, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(compareSemver)
const answered = (flows: readonly Flow[]) =>
  new Set(flows.flatMap(f => f.steps).filter((s): s is Exchange => 'op' in s && s.response.status < 300).map(s => s.op))

/** Whether this clone has a release's tag; null without git or outside a clone. */
function tagged(version: string): boolean | null {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: FIXTURES, stdio: 'ignore', windowsHide: true })
  try {
    git('rev-parse', '--git-dir')
  } catch {
    return null
  }
  try {
    git('rev-parse', '--verify', '--quiet', `refs/tags/v${version}^{commit}`)
    return true
  } catch {
    return false
  }
}

describe('compatibility fixtures', () => {
  it('the installed mod has its own (recorded in its release pull request)', () => {
    assert.ok(versions.includes(CLIENT_VERSION), `no test/compat/fixtures/${CLIENT_VERSION}: run node scripts/compat-record.ts`)
  })

  it('the recorder still plays every flow with the installed mod, and what it records replays', async () => {
    const flows = await recordFlows()
    const ok = answered(flows)
    assert.deepEqual(Object.keys(API_ROUTES).filter(op => !ok.has(op)), [], 'operations the recorder never answers')
    const frozen = (await import(pathToFileURL(join(FIXTURES, CLIENT_VERSION, 'schemas.ts')).href)) as Reader
    // an operation newer than the installed version's recording is read by the installed reader, until the release
    // that ships it records its own fixtures (docs/releasing.md); every older operation by the frozen one
    const reader: Reader = {
      ...frozen,
      parseResponse: (op, body) => (Object.hasOwn(frozen.RESPONSE_SCHEMAS, op) ? frozen.parseResponse(op, body) : parseResponse(op as ApiOp, body)),
    }
    for (const flow of flows) assert.deepEqual(await replay(flow, reader), [])

    // the allowlist, on a flow as an older server would have recorded it: a card kept off the trade list by the old trust gate
    const social = flows.find(f => f.flow === 'social')!
    const at = social.steps.findIndex(s => 'op' in s && s.op === 'setForTrade')
    const refusedThen: Flow = {
      ...social,
      steps: social.steps.map((s, i) => (i === at && 'op' in s
        ? { ...s, response: { status: 403, headers: s.response.headers, body: { error: { code: 'not_allowed', message: 'Trading opens once your account is 3 days old with 10 battles' } } } }
        : s)),
    }
    const strict = await replay(refusedThen, reader, new Set(), [])
    assert.match(strict.join('\n'), /answered 200, was 403/, 'a changed outcome fails unless it is listed')
    const entry: Loosened = { client: social.client, flow: 'social', step: at, op: 'setForTrade', was: 403, now: 200, reason: 'SPEC 8: no trust gate' }
    const used = new Set<Loosened>()
    assert.deepEqual(await replay(refusedThen, reader, used, [entry]), [])
    assert.ok(used.has(entry))
  })

  // Once the installed version is tagged, or with no git to ask, these checks pass without looking: never a skip,
  // which CI and the deploy refuse.
  const final = tagged(CLIENT_VERSION) !== false

  it('the installed mod\'s recording has the release notes the version check carries', () => {
    if (final) return
    const flow = JSON.parse(readFileSync(join(FIXTURES, CLIENT_VERSION, 'account.json'), 'utf8')) as Flow
    const step = flow.steps.find((s): s is Exchange => 'op' in s && s.op === 'version' && s.response.status === 200)
    assert.ok(step, 'account.json checks the version')
    const notes = (step.response.body as { notes?: unknown }).notes
    assert.ok(Array.isArray(notes) && notes.length > 0, `test/compat/fixtures/${CLIENT_VERSION}/account.json records no notes: re-record with node scripts/compat-record.ts --force`)
  })

  it('the installed mod\'s frozen reader is schemas.ts as it is now', async () => {
    if (final) return
    const lf = (s: string) => s.replace(/\r\n/g, '\n')
    const recorded = lf(readFileSync(join(FIXTURES, CLIENT_VERSION, 'schemas.ts'), 'utf8'))
    assert.ok(recorded === lf(await frozenReader(CLIENT_VERSION)),
      `test/compat/fixtures/${CLIENT_VERSION}/schemas.ts is stale: re-record with node scripts/compat-record.ts --force`)
  })

  it('reads a list-item field as optional only where the mod was seen without it', () => {
    const answer = (body: unknown): Flow['steps'][number] =>
      ({ op: 'me', player: 'a', at: 0, request: { method: 'GET', path: '/v1/me', headers: {} }, response: { status: 200, headers: {}, body } }) as never
    const flow: Flow = { client: '0.1.0', flow: 'x', about: '', steps: [
      answer({ notices: [{ id: '1', handle: 'h' }], cards: [{ id: 'c', level: 1 }] }),
      answer({ notices: [{ id: '2' }], cards: [{ id: 'd', level: 2 }] }),
    ] }
    assert.deepEqual([...optionalItemKeys([flow])], ['me $.notices[].handle'])
  })
})

for (const version of versions) {
  const dir = join(FIXTURES, version)
  const reader = (await import(pathToFileURL(join(dir, 'schemas.ts')).href)) as Reader
  const flows = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Flow)

  describe(`the ${version} mod against this server`, () => {
    const used = new Set<Loosened>()
    const optional = optionalItemKeys(flows)

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
        const problems = await replay(flow, reader, used, LOOSENED, optional)
        assert.ok(problems.length === 0, `the ${version} mod would break:\n${problems.join('\n')}`)
      })
    }

    it('lists only loosened outcomes that still happen, each with its reason', () => {
      for (const l of LOOSENED.filter(x => x.client === version)) {
        assert.ok(l.reason.trim().length > 0, `${l.flow} step ${l.step}: a reason`)
        assert.ok(used.has(l), `${l.flow} step ${l.step} (${l.op}) no longer answers ${l.now}: take it off LOOSENED`)
      }
    })
  })
}

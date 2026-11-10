// Release notes on GET /v1/version (SPEC 32): the newest announced releases, one answer for every mod, cached for an
// hour like the rest of the handshake, and kept whole by every mod that reads them. "Announced" means at or below
// LATEST_CLIENT, which equals the marketplace pin, so the answer holds both before and after a release's pin commit.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLIENT_VERSION, compareSemver } from '../../plugin/hooks/client/remote.ts'
import type { ReleaseNote, VersionResponse } from '../../plugin/hooks/core/api.ts'
import { NOTE_LIMITS, releasedUpTo } from '../../plugin/hooks/core/releases.ts'
import { LATEST_CLIENT } from '../../server/src/routes/account.ts'
import type { Reader } from '../compat/harness.ts'
import { exact, server } from './scaffold-helpers.ts'

const FIXTURES = fileURLToPath(new URL('../compat/fixtures/', import.meta.url))
/** The first release whose reader knows `notes`. */
const NOTES_READER = '0.3.0'

async function version(client: string | null = null): Promise<{ res: Response; text: string }> {
  const res = await server().request('GET', '/v1/version', { client })
  return { res, text: await res.text() }
}

describe('release notes on the version check', () => {
  it('carry the newest announced releases, newest first, and read back unchanged', async () => {
    const { res, text } = await version()
    assert.equal(res.status, 200)
    const v = exact('version', JSON.parse(text)) as VersionResponse
    assert.deepEqual(v.notes, JSON.parse(JSON.stringify(releasedUpTo(LATEST_CLIENT).slice(0, NOTE_LIMITS.sent))))
    assert.ok(v.notes!.length > 0, 'the announced release has notes')
    assert.equal(v.notes![0]!.version, LATEST_CLIENT, 'the newest note is the release announced as latest')
    assert.ok(v.notes!.every(n => compareSemver(n.version, LATEST_CLIENT) <= 0), 'never a release the marketplace does not serve yet')
  })

  it('stay one cached answer for every mod: an hour, public, no Vary, under 16 KB', async () => {
    const answers = await Promise.all([null, '0.1.0', '0.2.16', CLIENT_VERSION, '9.9.9'].map(version))
    for (const { res, text } of answers) {
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600')
      assert.equal(res.headers.get('vary'), null)
      assert.ok(new TextEncoder().encode(text).length < 16 * 1024, `${text.length} bytes`)
      assert.equal(text, answers[0]!.text, 'the same body whichever mod asks')
    }
  })

  it('stay under 16 KB and within the reader in the pin commit too, when this release is the latest', () => {
    const notes = releasedUpTo(CLIENT_VERSION).slice(0, NOTE_LIMITS.sent)
    assert.equal(notes[0]!.version, CLIENT_VERSION)
    const body = { api: 1, server: CLIENT_VERSION, rules: 1, generator: 2, minClient: '0.1.0', latestClient: CLIENT_VERSION, features: [], notes }
    assert.ok(JSON.stringify(body).length < 16 * 1024)
    assert.deepEqual(exact('version', JSON.parse(JSON.stringify(body))), JSON.parse(JSON.stringify(body)))
  })

  it('keep every release and highlight through each frozen reader that knows notes', async () => {
    const readers = readdirSync(FIXTURES).filter(v => compareSemver(v, NOTES_READER) >= 0).sort(compareSemver)
    assert.ok(readers.includes(NOTES_READER), `test/compat/fixtures/${NOTES_READER} is recorded`)
    const { text } = await version()
    const live = JSON.parse(text) as VersionResponse
    // and the notes the pin commit will send, so the recording holds after the release is announced as well
    const pinned: ReleaseNote[] = JSON.parse(JSON.stringify(releasedUpTo(CLIENT_VERSION).slice(0, NOTE_LIMITS.sent)))
    for (const v of readers) {
      const reader = (await import(pathToFileURL(join(FIXTURES, v, 'schemas.ts')).href)) as Reader
      for (const notes of [live.notes, pinned]) {
        const read = reader.parseResponse('version', { ...live, notes }) as VersionResponse
        assert.deepEqual(read.notes, notes, `the ${v} reader keeps every release and highlight (re-record ${v} with --force while it is untagged)`)
      }
    }
  })
})

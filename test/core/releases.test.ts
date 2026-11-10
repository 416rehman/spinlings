import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLIENT_VERSION, compareSemver } from '../../plugin/hooks/client/remote.ts'
import * as core from '../../plugin/hooks/core/index.ts'
import { NOTE_LIMITS, NOTES_FROM, RELEASES, releaseOf, releasedUpTo } from '../../plugin/hooks/core/releases.ts'
import { DAY_RE, NOTE_READ, NOTE_TEXT_RE, RELEASE_RE, parse, releaseNoteSchema } from '../../plugin/hooks/core/schemas.ts'
import { LATEST_CLIENT } from '../../server/src/routes/account.ts'

const CHANGELOG = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Every release heading, `## 0.3.0 (2026-11-09)`; a heading without a version (a server-only deploy) is no release. */
const headingsOf = (text: string) => [...text.matchAll(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/gm)].map(m => ({ version: m[1]!, date: m[2]! }))
const headings = headingsOf(CHANGELOG)
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

test('releases run newest first: strictly falling versions, unique, dates that never rise', () => {
  assert.ok(RELEASES.length > 0)
  for (const [i, r] of RELEASES.entries()) {
    assert.match(r.version, RELEASE_RE, r.version)
    assert.match(r.date, DAY_RE, r.version)
    if (i === 0) continue
    const prev = RELEASES[i - 1]!
    assert.equal(compareSemver(prev.version, r.version), 1, `${prev.version} comes before ${r.version}`)
    assert.ok(prev.date >= r.date, `${prev.version} is dated no earlier than ${r.version}`)
  }
  assert.equal(new Set(RELEASES.map(r => r.version)).size, RELEASES.length)
  assert.equal(RELEASES.at(-1)!.version, NOTES_FROM, 'the oldest entry is the first release with notes')
})

test('the installed mod has notes, and the server announces only a release that has them, never a newer one', () => {
  assert.equal(RELEASES[0]!.version, CLIENT_VERSION)
  assert.notEqual(releaseOf(LATEST_CLIENT), null, `releases.ts has no entry for LATEST_CLIENT ${LATEST_CLIENT}`)
  assert.ok(compareSemver(LATEST_CLIENT, CLIENT_VERSION) <= 0, `LATEST_CLIENT ${LATEST_CLIENT} is above this mod`)
})

test('every entry matches a CHANGELOG heading with the same date, and every release heading from NOTES_FROM on has an entry', () => {
  assert.ok(headings.some(h => h.version === NOTES_FROM), `CHANGELOG.md has a ${NOTES_FROM} heading`)
  for (const r of RELEASES) {
    const h = headings.find(x => x.version === r.version)
    assert.ok(h, `CHANGELOG.md has no "## ${r.version} (date)" heading`)
    assert.equal(r.date, h.date, `${r.version} is dated as its CHANGELOG heading`)
  }
  for (const h of headings.filter(x => compareSemver(x.version, NOTES_FROM) >= 0)) {
    assert.notEqual(releaseOf(h.version), null, `releases.ts has no entry for CHANGELOG's ${h.version}`)
  }
  // a heading without a version is skipped, not read as a release
  assert.deepEqual(headingsOf('## 0.3.1 (2026-12-01)\n\n## Server and website update (2026-11-20)\n\n## 0.3.0 (2026-11-09)\n'),
    [{ version: '0.3.1', date: '2026-12-01' }, { version: '0.3.0', date: '2026-11-09' }])
})

test('each release has 1 to 4 highlights in plain words, within the author bounds', () => {
  for (const r of RELEASES) {
    assert.ok(r.highlights.length >= 1 && r.highlights.length <= NOTE_LIMITS.highlights, `${r.version} has 1 to ${NOTE_LIMITS.highlights} highlights`)
    assert.equal(new Set(r.highlights.map(h => h.short)).size, r.highlights.length, `${r.version}'s short labels are unique`)
    for (const h of r.highlights) {
      const at = `${r.version} "${h.short}"`
      assert.ok(h.short.length >= 1 && h.short.length <= NOTE_LIMITS.short, `${at}: short is 1 to ${NOTE_LIMITS.short} characters`)
      assert.ok(h.text.length <= NOTE_LIMITS.text, `${at}: text is ${h.text.length} characters, over ${NOTE_LIMITS.text}`)
      assert.ok(h.text.endsWith('.'), `${at}: text ends in a period`)
      assert.ok(!h.short.includes('—') && !h.text.includes('—'), `${at}: no em dash`)
      assert.match(h.short, NOTE_TEXT_RE, at)
      assert.match(h.text, NOTE_TEXT_RE, at)
    }
  }
})

test('every entry reads back unchanged through the mod\'s reader, within the bounds it reads', () => {
  for (const r of RELEASES) assert.deepEqual(parse(releaseNoteSchema, json(r)), json(r), r.version)
  for (const k of ['highlights', 'short', 'text'] as const) assert.ok(NOTE_LIMITS[k] <= NOTE_READ[k], `NOTE_LIMITS.${k} is within NOTE_READ.${k}`)
  assert.ok(NOTE_LIMITS.sent <= NOTE_READ.releases, 'the server never sends more releases than the reader keeps')
})

test('releasedUpTo keeps releases at or below a version, compared as numbers, newest first', () => {
  const versions = (latest: string) => releasedUpTo(latest).map(r => r.version)
  const all = RELEASES.map(r => r.version)
  assert.deepEqual(versions(CLIENT_VERSION), all)
  assert.deepEqual(versions('99.0.0'), all)
  assert.deepEqual(versions('0.2.16'), all.filter(v => compareSemver(v, '0.2.16') <= 0))
  assert.deepEqual(versions('0.2.16'), ['0.2.16', '0.2.15', '0.2.14', '0.2.13'])
  assert.deepEqual(versions('0.2.13'), ['0.2.13'])
  assert.deepEqual(versions('0.2.12'), [])
  assert.deepEqual(versions('0.2.9'), [], '0.2.9 is below 0.2.13 as numbers, though above it as text')
  assert.deepEqual(versions('0.2.100'), all.filter(v => v.startsWith('0.2.')))
  assert.deepEqual(versions('0.3.0-beta.1'), all.filter(v => v !== '0.3.0'), 'a pre-release sits below its release')
  assert.deepEqual(versions('0.3.1-beta.1'), versions('0.3.0'))
  for (const junk of ['', 'latest', '0.3', 'v0.3.0', '0.3.0.1']) assert.deepEqual(versions(junk), [], JSON.stringify(junk))
  const out = releasedUpTo(CLIENT_VERSION)
  assert.notEqual(out, RELEASES, 'a fresh list')
  out.pop()
  assert.equal(RELEASES.length, all.length)
})

test('releaseOf finds one release; the bundled notes are frozen; core exports them', () => {
  assert.equal(releaseOf(CLIENT_VERSION), RELEASES[0])
  assert.equal(releaseOf('0.2.12'), null)
  assert.equal(releaseOf('0.3.0-beta.1'), null)
  assert.equal(releaseOf(''), null)
  assert.ok(Object.isFrozen(RELEASES) && Object.isFrozen(RELEASES[0]) && Object.isFrozen(RELEASES[0]!.highlights) && Object.isFrozen(RELEASES[0]!.highlights[0]))
  for (const name of ['NOTE_LIMITS', 'NOTES_FROM', 'RELEASES', 'releaseOf', 'releasedUpTo', 'WHATS_NEW', 'compareSemver', 'isRelease', 'RELEASE_RE', 'NOTE_TEXT_RE', 'NOTE_READ', 'highlightSchema', 'releaseNoteSchema']) {
    assert.ok(Object.hasOwn(core, name), `core/index.ts exports ${name}`)
  }
})

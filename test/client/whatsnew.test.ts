// What's new, pure (SPEC 32): when boot greets a version, which releases lie between two, the band's whole-label chip
// line, /spin version's notes line, and which of a version answer's notes the mod keeps: only spinlings.dev's, only
// for releases this mod is missing, newest first, each once.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ReleaseNote, VersionResponse } from '../../plugin/hooks/core/api.ts'
import { RULES_VERSION } from '../../plugin/hooks/core/battle.ts'
import { RELEASES, releaseOf } from '../../plugin/hooks/core/releases.ts'
import { DEFAULT_SERVER } from '../../plugin/hooks/core/servers.ts'
import { GENERATOR_VERSION } from '../../plugin/hooks/core/species.ts'
import { CLIENT_VERSION, versionStatus } from '../../plugin/hooks/client/remote.ts'
import { readNotes, readRelease } from '../../plugin/hooks/client/store.ts'
import { cells } from '../../plugin/hooks/client/text.ts'
import { CHIP_LEAD, CHIP_SEP, bundledSince, chipLine, greeting, labelsOf, moreOf, notesBetween, notesLine } from '../../plugin/hooks/client/whatsnew.ts'

const note = (version: string, ...shorts: string[]): ReleaseNote => ({ version, date: '2026-11-09', highlights: shorts.map(short => ({ short, text: `${short} came.` })) })
const VERSION: VersionResponse = {
  api: 1, server: '1.0.0', rules: RULES_VERSION, generator: GENERATOR_VERSION, minClient: '0.0.1', latestClient: '0.3.0', features: [],
}
/** How the band draws a chip line (band.tsx chipRow), so its width is counted as it is drawn. */
const drawn = (fit: { shorts: string[]; more: number }) => CHIP_LEAD + fit.shorts.join(CHIP_SEP) + (fit.more > 0 ? moreOf(fit.more) : '')

it('greets a version once: never on a first install, from what ran before, nothing and no write after a downgrade', () => {
  assert.deepEqual(greeting(null, true, '0.3.0'), { show: false, from: '', save: { v: 1, ran: '0.3.0' } })
  // a mod from before 0.3.0 ran here: it kept no record, so the version it came from is not known
  assert.deepEqual(greeting(null, false, '0.3.0'), { show: true, from: '', save: { v: 1, ran: '0.3.0' } })
  assert.deepEqual(greeting({ v: 1, ran: '0.2.16' }, false, '0.3.0'), { show: true, from: '0.2.16', save: { v: 1, ran: '0.3.0' } })
  // a record wins over a first run, which a cleared prefs record can look like
  assert.deepEqual(greeting({ v: 1, ran: '0.2.16' }, true, '0.3.0'), { show: true, from: '0.2.16', save: { v: 1, ran: '0.3.0' } })
  assert.deepEqual(greeting({ v: 1, ran: '0.3.0' }, false, '0.3.0'), { show: false, from: '', save: null })
  assert.deepEqual(greeting({ v: 1, ran: '0.3.1' }, false, '0.3.0'), { show: false, from: '', save: null })
  assert.deepEqual(greeting({ v: 1, ran: '0.10.0' }, false, '0.9.9'), { show: false, from: '', save: null })
})

it('reads back only a release record it could have written', () => {
  assert.deepEqual(readRelease({ v: 1, ran: '0.3.0' }), { v: 1, ran: '0.3.0' })
  for (const bad of [undefined, null, 'x', [], {}, { v: 2, ran: '0.3.0' }, { v: 1, ran: '0.3.0-beta' }, { v: 1, ran: 3 }, { v: 1, ran: '1.2' }]) {
    assert.equal(readRelease(bad), null, JSON.stringify(bad))
  }
})

it('the releases between two versions: after < version <= upTo, newest first, each once', () => {
  assert.deepEqual(notesBetween(RELEASES, '0.2.13', '0.3.0').map(r => r.version), ['0.3.0', '0.2.16', '0.2.15', '0.2.14'])
  assert.deepEqual(notesBetween(RELEASES, '0.2.16', '0.3.0').map(r => r.version), ['0.3.0'])
  assert.deepEqual(notesBetween(RELEASES, '0.3.0', '0.3.0'), [])
  const mixed = [note('0.2.15', 'b'), note('0.3.0', 'a'), note('0.2.15', 'again'), note('0.3.1-rc', 'x'), note('0.4.0', 'later')]
  assert.deepEqual(notesBetween(mixed, '0.2.14', '0.3.0').map(r => r.highlights[0]!.short), ['a', 'b'])
  // an end that is no release (a version not known) gives nothing, never every release
  assert.deepEqual(notesBetween(RELEASES, '', '0.3.0'), [])
  assert.deepEqual(notesBetween(RELEASES, '0.2.13', 'next'), [])
  // a test build comes before its release
  assert.deepEqual(notesBetween(RELEASES, '0.3.0-beta.1', '0.3.0').map(r => r.version), ['0.3.0'])
})

it('what the mod carries since a version: that release and every one after it, or this one alone when it is not known', () => {
  assert.deepEqual(bundledSince('0.2.15', '0.3.0').map(r => r.version), ['0.3.0', '0.2.16'])
  assert.deepEqual(bundledSince('', '0.3.0').map(r => r.version), ['0.3.0'])
  assert.deepEqual(bundledSince('', '0.2.12'), [])
  assert.equal(labelsOf(bundledSince('0.2.16', '0.3.0')), 'Open all · Auto-update · Card search')
})

it('the chip line keeps whole labels only, counts its own +N more, and is nothing when not even one fits', () => {
  const h = releaseOf('0.3.0')!.highlights
  const all = chipLine(h, 80)!
  assert.deepEqual(all, { shorts: ['Open all', 'Auto-update', 'Card search'], more: 0 })
  assert.equal(cells(drawn(all)), 38)
  assert.deepEqual(chipLine(h, 38), all)
  // one cell short: the last label goes, and its "+1 more" has to fit as well
  assert.deepEqual(chipLine(h, 37), { shorts: ['Open all', 'Auto-update'], more: 1 })
  assert.deepEqual(chipLine(h, 31), { shorts: ['Open all'], more: 2 })
  assert.equal(cells(drawn(chipLine(h, 31)!)), 18)
  assert.equal(chipLine(h, 18)?.shorts.length, 1)
  assert.equal(chipLine(h, 17), null)
  assert.equal(chipLine(h, 11), null)
  assert.equal(chipLine([], 80), null)
  // at every room, what it keeps fits that room, and every label kept is whole
  for (let room = 1; room <= 60; room++) {
    const fit = chipLine(h, room)
    if (!fit) continue
    assert.ok(cells(drawn(fit)) <= room, `room ${room}`)
    for (const s of fit.shorts) assert.ok(h.some(x => x.short === s), s)
  }
})

it('/spin version\'s notes line: every label, the newest release first', () => {
  assert.equal(notesLine([releaseOf('0.3.0')!], '0.2.16'), 'New since 0.2.16: Open all · Auto-update · Card search')
  assert.equal(notesLine([note('0.4.0', 'A', 'B'), note('0.3.1', 'C')], '0.3.0'), 'New since 0.3.0: A · B · C')
})

it('a version answer\'s notes: only for missing releases up to the target, newest first, each once, from spinlings.dev alone', () => {
  const notes = [note('0.2.15', 'Fifteen'), note('0.3.0', 'Thirty'), note('0.2.16', 'Sixteen'), note('0.2.16', 'Again'), note('0.2.14', 'Fourteen')]
  const behind = versionStatus({ ...VERSION, notes }, '0.2.14', DEFAULT_SERVER)
  assert.equal(behind.target, '0.3.0')
  assert.deepEqual(behind.notes.map(n => n.highlights[0]!.short), ['Thirty', 'Sixteen', 'Fifteen'])
  // a lagging server: latestClient names nothing newer, so minClient is the target, and nothing above it is told
  const lagging = versionStatus({ ...VERSION, minClient: '0.2.16', latestClient: '0.2.15', notes }, '0.2.14', DEFAULT_SERVER)
  assert.deepEqual({ target: lagging.target, readOnly: lagging.readOnly }, { target: '0.2.16', readOnly: true })
  assert.deepEqual(lagging.notes.map(n => n.version), ['0.2.16', '0.2.15'])
  // another server's notes are read and dropped: it cannot put words beside the official update steps
  assert.deepEqual(versionStatus({ ...VERSION, notes }, '0.2.14', 'https://cats.example').notes, [])
  // and a caller that names no server gets none: the rule never rests on remembering an argument
  assert.deepEqual(versionStatus({ ...VERSION, notes }, '0.2.14').notes, [])
  // a test build is still behind the release it leads to
  assert.deepEqual(versionStatus({ ...VERSION, notes }, '0.3.0-beta.1', DEFAULT_SERVER).notes.map(n => n.version), ['0.3.0'])
  // current: nothing missing, so nothing to tell
  assert.deepEqual(versionStatus({ ...VERSION, notes }, '0.3.0', DEFAULT_SERVER).notes, [])
  assert.deepEqual(versionStatus({ ...VERSION, latestClient: '0.3.0' }, '0.2.14', DEFAULT_SERVER).notes, [])
  // a pre-release is never a target, so it brings no notes either
  assert.deepEqual(versionStatus({ ...VERSION, latestClient: '0.3.1-rc', notes: [note('0.3.1', 'X')] }, CLIENT_VERSION, DEFAULT_SERVER).notes, [])
})

it('the stored notes read back through the reader\'s bounds, and anything else reads as none', () => {
  const kept = { v: 1, notes: [note('0.3.0', 'Open all'), { version: 'x', date: 'y', highlights: [] }, note('0.2.16', 'Wrapped rewards')] }
  assert.deepEqual(readNotes(kept).map(n => n.version), ['0.3.0', '0.2.16'])
  const bads = [undefined, null, 'notes', [], { v: 1, notes: 'x' }, { v: 1, notes: [{ version: '0.3.0' }] }, { notes: kept.notes }, { v: 2, notes: kept.notes }]
  for (const bad of bads) assert.deepEqual(readNotes(bad), [], JSON.stringify(bad))
  // a label made to break the band: a bidi override is not one cell per character, so the release keeps none of it
  const hostile = { v: 1, notes: [{ version: '0.3.0', date: '2026-11-09', highlights: [{ short: 'Open‮all', text: 'Fine.' }] }] }
  assert.deepEqual(readNotes(hostile), [])
})

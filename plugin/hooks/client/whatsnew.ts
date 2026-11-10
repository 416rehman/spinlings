// What's new (SPEC 32): whether to greet a version that just arrived on this computer, which releases lie between two
// versions, and the short labels the band and /spin version draw. Pure; the notes themselves are core/releases.ts's
// (bundled) or spinlings.dev's (on the version check).
import type { ReleaseHighlight, ReleaseNote } from '../core/api.ts'
import { RELEASES, releaseOf } from '../core/releases.ts'
import { NOTE_READ } from '../core/schemas.ts'
import { compareSemver, isRelease, isVersion } from '../core/versions.ts'
import { MARK } from '../ui/tokens.ts'
import { cells, safe } from './text.ts'

/** How the band's chip line starts, and what stands between two labels: chipLine measures with these, and the band draws them. */
export const CHIP_LEAD = `${MARK.sparkle} `
export const CHIP_SEP = ' · '
/** The chip line's tail when labels are left out. */
export const moreOf = (n: number) => ` +${n} more`

/** The newest version that has run on this computer ($.store `release`). It only moves forward. */
export type ReleaseRecord = { v: 1; ran: string }

/**
 * Whether boot greets the installed version, from what last ran here. No record on a first run: no greeting, the
 * version saved. No record otherwise: a mod from before 0.3.0 ran here, so greet it, from an unknown version. An older
 * version ran: greet, from that one. The same: nothing. A newer one (a downgrade): nothing, and nothing written.
 */
export function greeting(rec: ReleaseRecord | null, firstRun: boolean, client: string): { show: boolean; from: string; save: ReleaseRecord | null } {
  const save: ReleaseRecord = { v: 1, ran: client }
  if (!rec) return { show: !firstRun, from: '', save }
  if (compareSemver(rec.ran, client) < 0) return { show: true, from: rec.ran, save }
  return { show: false, from: '', save: null }
}

/**
 * The releases with `after` < version <= `upTo`, newest first, each version once. `after` may be a pre-release (a
 * test build is still behind the release it leads to); nothing when `upTo` is no release or `after` no version.
 */
export function notesBetween(releases: readonly ReleaseNote[], after: string, upTo: string): ReleaseNote[] {
  if (!isVersion(after) || !isRelease(upTo)) return []
  const out: ReleaseNote[] = []
  const sorted = releases
    .filter(r => isRelease(r.version) && compareSemver(r.version, after) > 0 && compareSemver(r.version, upTo) <= 0)
    .sort((a, b) => compareSemver(b.version, a.version))
  for (const r of sorted) if (!out.some(x => x.version === r.version)) out.push(r)
  return out
}

/** What this mod carries about `version` and, when `from` is known, every release since it, newest first. */
export function bundledSince(from: string, version: string): ReleaseNote[] {
  return from ? notesBetween(RELEASES, from, version) : [releaseOf(version)].filter(n => n !== null)
}

/** A highlight's label as drawn: the reader's bound, never the 80 a plain `safe` cuts at. */
export const shortOf = (h: ReleaseHighlight) => safe(h.short, NOTE_READ.short)

/** Every label of `notes`, in order, as one line: `Open all · Auto-update · Card search`. */
export const labelsOf = (notes: readonly ReleaseNote[]) => notes.flatMap(n => n.highlights.map(shortOf)).join(CHIP_SEP)

/**
 * The leading labels that fit `room` cells as `✦ a · b · c`, then ` +N more` when some are left out (that counts too):
 * whole labels only, never one cut. Null when not even the first fits.
 */
export function chipLine(highlights: readonly ReleaseHighlight[], room: number): { shorts: string[]; more: number } | null {
  const all = highlights.map(shortOf).filter(s => s !== '')
  for (let k = all.length; k >= 1; k--) {
    const shorts = all.slice(0, k)
    const more = all.length - k
    const width = cells(CHIP_LEAD + shorts.join(CHIP_SEP)) + (more > 0 ? cells(moreOf(more)) : 0)
    if (width <= room) return { shorts, more }
  }
  return null
}

/** `New since 0.3.0: Open all · Auto-update · Card search`: every label, the newest release first. */
export function notesLine(notes: readonly ReleaseNote[], since: string): string {
  return `New since ${safe(since, 16)}: ${labelsOf(notes)}`
}

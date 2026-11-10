// Release notes (SPEC 32): what each release brought, in a player's words. The mod draws its own bundled entries,
// and the server sends the announced ones on /v1/version and lists them on /whats-new. CHANGELOG.md stays technical.
import type { ReleaseNote } from './api.ts'
import { deepFreeze } from './species.ts'
import { compareSemver, isVersion } from './versions.ts'

/** Author bounds, which tests hold every entry to (the reader's wider ones are NOTE_READ in schemas.ts), and how many /v1/version carries. */
export const NOTE_LIMITS = { highlights: 4, short: 24, text: 120, sent: 5 } as const

/** The first release with notes; earlier ones live in CHANGELOG.md. */
export const NOTES_FROM = '0.2.13'

/** Newest first. Each `date` is its CHANGELOG heading's; the most important highlight comes first. */
export const RELEASES: readonly ReleaseNote[] = deepFreeze([
  {
    version: '0.3.0', date: '2026-11-10', highlights: [
      { short: 'Open all', text: 'Open every waiting pack at once. The best pulls get their own beat, then the rest, grouped by rarity.' },
      { short: 'Auto-update', text: 'One press in /spin updates, and each new Spinlings arrives by itself a few minutes after Claude Code starts.' },
      { short: 'Card search', text: 'Search on spinlings.dev finds players, and the creatures people hold by name, family, rarity or finish.' },
    ],
  },
  {
    version: '0.2.16', date: '2026-10-06', highlights: [
      { short: 'Clearer code pages', text: 'Redeem-code pages show the reward, how many have claimed it and the day it closes.' },
      { short: 'Wrapped rewards', text: 'Pack and card rewards come as a wrapped present. Eggs still hatch in their nest.' },
    ],
  },
  {
    version: '0.2.15', date: '2026-10-05', highlights: [
      { short: 'Named arenas', text: 'On the desktop, each battle scene names its arena after the model family in use: Haiku, Sonnet, Opus or Fable.' },
    ],
  },
  {
    version: '0.2.14', date: '2026-10-05', highlights: [
      { short: 'Pixel arenas', text: 'Moss Grove, Moonlit Water, Ember Cliffs and Floating Isles, redrawn in the same chunky pixels as your creatures.' },
      { short: 'Knockout shadows', text: 'Each fighter stands on its own shadow, which fades when it is knocked out.' },
      { short: 'Fits narrow panes', text: 'In a narrow pane the scene shifts so both creatures stay on their platforms.' },
    ],
  },
  {
    version: '0.2.13', date: '2026-10-05', highlights: [
      { short: 'Painted arenas', text: 'On the desktop, both creatures fight in one scene: a sunlit grove, moonlit ruins, ember cliffs or floating isles.' },
      { short: 'Health at a glance', text: 'Compact health bars and clear hit effects sit right in the scene.' },
      { short: 'Now! below the fight', text: 'Round, streak and the Now! button share one row under the arena.' },
    ],
  },
])

/** One release's notes, or null when it has none. */
export function releaseOf(version: string): ReleaseNote | null {
  return RELEASES.find(r => r.version === version) ?? null
}

/** Releases at or below `latest`, newest first: all the server may announce or list. A pre-release `latest` sits just below its release. */
export function releasedUpTo(latest: string): ReleaseNote[] {
  return isVersion(latest) ? RELEASES.filter(r => compareSemver(r.version, latest) <= 0) : []
}

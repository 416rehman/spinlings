// Export the game's original synthesized chimes for maintainer listening, outside the installable plugin.
// Run from the repository root: node scripts/chimes.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHIME_NAMES, chimeWav } from '../plugin/hooks/client/chimes.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev', 'chimes')
mkdirSync(dir, { recursive: true })
for (const cue of CHIME_NAMES) {
  const bytes = chimeWav(cue)
  writeFileSync(join(dir, `chime-${cue}.wav`), bytes)
  console.log(`.dev/chimes/chime-${cue}.wav  ${(bytes.length / 1024).toFixed(1)} KB`)
}

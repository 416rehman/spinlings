// Renders the launch media into docs/media from the game's own code: animated SVG recordings (light and dark) and
// the PNG stills. Usage: node scripts/media/build.ts [encounter|pack|evolve|gallery|stills ...]
import './load.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEMES } from './view.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const OUT = resolve(root, 'docs/media')
const LIMIT = 300 * 1024

const want = new Set(process.argv.slice(2))
const on = (name: string) => want.size === 0 || want.has(name)

mkdirSync(OUT, { recursive: true })

function save(name: string, svg: string): void {
  const file = resolve(OUT, name)
  writeFileSync(file, svg)
  const kb = Buffer.byteLength(svg) / 1024
  console.log(`${name.padEnd(28)} ${kb.toFixed(1).padStart(6)} KB${kb * 1024 > LIMIT ? '  OVER 300 KB' : ''}`)
  if (kb * 1024 > LIMIT) process.exitCode = 1
}

const recordings: [string, () => Promise<(t: (typeof THEMES)['dark']) => string>][] = [
  ['encounter', async () => (await import('./encounter.ts')).encounterSvg],
  ['pack', async () => (await import('./pack.ts')).packSvg],
  ['evolve', async () => (await import('./evolve.ts')).evolveSvg],
  ['gallery', async () => (await import('./gallery.ts')).gallerySvg],
]

for (const [name, load] of recordings) {
  if (!on(name)) continue
  const make = await load()
  for (const t of [THEMES.dark, THEMES.light]) save(`${name}-${t.name}.svg`, make(t))
}

if (on('stills')) {
  const { stills } = await import('./stills.ts')
  for (const [name, png] of await stills()) {
    writeFileSync(resolve(OUT, name), png)
    console.log(`${name.padEnd(28)} ${(png.length / 1024).toFixed(1).padStart(6)} KB`)
  }
}

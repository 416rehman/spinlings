// The README's pictures show on GitHub: each is a repo-relative path into docs/media that exists, each <picture> has
// a dark and a light take of the same recording, and each image says in its alt text what it shows.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { it } from 'node:test'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { FAMILIES } from '../../plugin/hooks/core/families.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { EYE, SHINE, spriteFor } from '../../plugin/hooks/core/sprite.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const readme = readFileSync(ROOT + 'README.md', 'utf8').replace(/\r\n/g, '\n')
const species = FAMILIES.flatMap(f => familySpecies(1, f))
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')
/** Every colour of every stage of every season-1 species, bar the shared eye and shine. */
const colours = new Set(species.flatMap(s => ([1, 2, 3] as const).flatMap(stage => spriteFor({ form: s, stage }).flat()))
  .filter(c => c >= 0 && c !== EYE && c !== SHINE).map(hex))

it('the README embeds docs/media relatively, in both themes, with alt text', () => {
  const pictures = [...readme.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map(m => m[1]!)
  assert.ok(pictures.length >= 4, 'the hero and the "See it" recordings')
  for (const p of pictures) {
    const dark = /<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">/.exec(p)?.[1]
    const light = /<img src="([^"]+)"/.exec(p)?.[1]
    assert.ok(dark && light, `a <picture> needs a dark <source> and a light <img>:\n${p}`)
    assert.equal(dark.replace('-dark.', '-light.'), light, `${dark} and ${light} should be one recording's two themes`)
  }

  const images = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"|!\[[^\]]*\]\(([^)\s]+)/g)].map(m => (m[1] ?? m[2])!)
  for (const path of images) {
    if (/^https:\/\//.test(path)) {
      assert.doesNotMatch(path, /docs\/media/, `${path}: link docs/media relatively, so forks and tags show their own`)
      continue
    }
    assert.match(path, /^docs\/media\/[\w.-]+$/, `${path}: README images live in docs/media, linked from the repo root`)
    assert.ok(existsSync(ROOT + path), `${path} is missing`)
  }

  for (const [tag] of readme.matchAll(/<img\b[^>]*>/g)) assert.match(tag, /\balt="[^"]{40,}"/, `${tag}: say what it shows in the alt text`)
  assert.ok(readme.includes('\n## See it\n'), 'the README has a "See it" section')
})

// The season stays a secret until players find it, as it does on the site: the season poster shows every species as
// a shadow, so no name, no colour of any stage of any species, and alt text that names none of them either.
it('the season poster holds the species back', () => {
  const names = new Set(species.flatMap(s => s.names))
  const mask = (px: number[][]) => px.flatMap((r, y) => r.map((c, x) => (c >= 0 ? `${x},${y}` : ''))).filter(Boolean).sort().join(' ')
  assert.ok(names.size > 36 && colours.size > 36, 'season 1 has its species')

  for (const theme of ['dark', 'light']) {
    const file = `docs/media/gallery-${theme}.svg`
    const svg = readFileSync(ROOT + file, 'utf8')
    for (const name of names) assert.doesNotMatch(svg, new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`), `${file} names ${name}`)
    for (const [, c] of svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{6})"/g)) assert.ok(!colours.has(c!.toLowerCase()), `${file} paints a species in its own colour ${c}`)
    // and each shadow is its album form, never a later stage
    const groups = svg.split('scale(4)" shape-rendering="crispEdges">').slice(1)
    assert.equal(groups.length, species.length, `${file} draws one shadow per species`)
    species.forEach((s, i) => {
      const still = groups[i]!.split(/<g (?:opacity|visibility)=/)[0]!
      const cells = new Set([...still.matchAll(/M(\d+) (\d+)h(\d+)/g)].flatMap(([, x, y, n]) => Array.from({ length: +n! }, (_, k) => `${+x! + k},${y}`)))
      assert.equal([...cells].sort().join(' '), mask(spriteFor({ form: s, stage: s.legendary ? 3 : 1 })), `${file}: ${s.id} shows only its album form`)
    })
  }
  const alt = /<img src="docs\/media\/gallery-light\.svg"[^>]*\balt="([^"]+)"/.exec(readme)?.[1]
  assert.ok(alt, 'the README shows the season poster')
  for (const name of names) assert.ok(!alt.includes(name), `the poster's alt text names ${name}`)
})

it('the season still holds the species back', () => {
  const png = readFileSync(ROOT + 'docs/media/ph-4-season.png')
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), idat: Buffer[] = []
  for (let o = 8; o < png.length; o += 12 + png.readUInt32BE(o)) if (png.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + png.readUInt32BE(o)))
  const raw = inflateSync(Buffer.concat(idat)), row = w * 4 + 1, seen = new Set<string>()
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * row], 0, 'encodePng writes unfiltered rows')
    for (let i = y * row + 1; i < (y + 1) * row; i += 4) seen.add(hex((raw[i]! << 16) | (raw[i + 1]! << 8) | raw[i + 2]!))
  }
  for (const c of seen) assert.ok(!colours.has(c), `ph-4-season.png paints a species in its own colour ${c}`)
})

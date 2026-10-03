// The README's pictures show on GitHub: each is a repo-relative path into docs/media that exists, each <picture> has
// a dark and a light take of the same recording, and each image says in its alt text what it shows.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const readme = readFileSync(ROOT + 'README.md', 'utf8').replace(/\r\n/g, '\n')

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

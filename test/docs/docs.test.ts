// The docs say what the code does (SPEC preamble): no per-day quotas, which SPEC 24 removed; every `/spin`
// subcommand in the README; every hook the mod registers in the README's and PRIVACY.md's lists of what it reads.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { USAGE } from '../../plugin/hooks/client/commands.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(ROOT + path, 'utf8')
const DOCS = [
  'README.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  ...readdirSync(ROOT + 'docs').filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
]

/** "3 a day", "up to 10 times a day", "one a day", "per day", "each UTC day", "daily cap", "2 a week" */
const QUOTA = /\b(\d+|one|once|twice)( \w+){0,2} (a|per|each) (UTC )?day\b|\bper (UTC )?day\b|\beach UTC day\b|\bdaily (game )?caps?\b|\b\d+( \w+)? a week\b/i
/** what SPEC 24 keeps: the Trader's daily stock, and the join limits per network */
const KEPT = /trader|deal|join/i

/** The body of the `## heading` section of a markdown file. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`)
  assert.ok(start >= 0, `no "## ${heading}" section`)
  const end = text.indexOf('\n## ', start + 1)
  return text.slice(start, end < 0 ? undefined : end)
}

describe('the docs match the game', () => {
  it('no doc describes a per-day quota (SPEC 24)', () => {
    for (const file of DOCS) {
      read(file).split('\n').forEach((line, i) => {
        if (QUOTA.test(line) && !KEPT.test(line)) assert.fail(`${file}:${i + 1} reads like a daily quota: ${line.trim()}`)
      })
    }
  })

  it('the README lists every /spin subcommand', () => {
    const readme = section(read('README.md'), 'How it plays')
    const subs = [...USAGE.matchAll(/^\/spin (\w+)/gm)].map(m => m[1]!)
    assert.ok(subs.length >= 15)
    for (const sub of subs) assert.ok(readme.includes(`\`/spin ${sub}`), `README's command table leaves out /spin ${sub}`)
  })

  it('the README and PRIVACY.md name every hook the mod registers, and the ones it never does', () => {
    const hooks = [...new Set([...read('plugin/hooks/register.tsx').matchAll(/\bon\(\s*(['"`])([\w.]+)\1/g)].map(m => m[2]!))]
    assert.ok(hooks.length > 0)
    const lists = { README: section(read('README.md'), "What Spinlings can't read"), PRIVACY: section(read('PRIVACY.md'), 'What the mod reads on your machine') }
    for (const [doc, text] of Object.entries(lists)) {
      for (const hook of [...hooks, 'tool.call', 'prompt.submit', 'classic.PermissionRequest']) assert.ok(text.includes(`\`${hook}\``), `${doc} leaves out ${hook}`)
    }
  })
})

// The update switch and the update news (SPEC 32) as the docs tell it: the README's third install step and its leave
// line, what the mod reads and writes on your computer in the README and PRIVACY.md, the $ calls every reviewer-facing
// page lists, the environment names, held to the ones the mod's source reads, and how a release is announced.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CLIENT_VERSION } from '../../plugin/hooks/client/remote.ts'
import { KEYS } from '../../plugin/hooks/client/store.ts'
import { UPDATE_ENV } from '../../server/src/pages-info.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(ROOT + path, 'utf8').replace(/\r\n/g, '\n')
const README = read('README.md')
const PRIVACY = read('PRIVACY.md')
const SPEC = read('SPEC.md')

/** The body of the `## heading` section of a markdown file. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`)
  assert.ok(start >= 0, `no "## ${heading}" section`)
  const end = text.indexOf('\n## ', start + 1)
  return text.slice(start, end < 0 ? undefined : end)
}

/** Every environment name the mod's source reads; the engine takes only literal names, so this is all of them. */
function envInSource(): string[] {
  const dir = ROOT + 'plugin/hooks/'
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f))
  return [...new Set(files.flatMap(f => [...readFileSync(dir + f, 'utf8').matchAll(/\$\.env\.get\(\s*(['"`])([A-Z0-9_]+)\1\s*\)/g)].map(m => m[2]!)))].sort()
}

describe('the update switch in the docs', () => {
  it('the README installs in three steps, the third optional: /spin updates and Turn it on, or the terminal\'s /plugin way', () => {
    const install = section(README, 'Install')
    assert.match(install, /\n1\. Two commands inside Claude Code, one at a time:\n\n {3}```\n {3}\/plugin marketplace add 416rehman\/spinlings\n {3}\/plugin install spinlings@spinlings\n {3}```\n/)
    assert.match(install, /\n2\. Restart Claude and start a new session, then run `\/spin` to open your team\.\n/)
    assert.ok(install.includes('\n3. **Updates by themselves (optional).** In your new session, run `/spin updates` and press **Turn it on**. Or, in a terminal: `/plugin`, then Marketplaces, then spinlings, then Enable auto-update.\n'))
    assert.ok(install.includes('Uninstalling keeps the spinlings marketplace and its auto-update; `claude plugin marketplace remove spinlings` removes both.'))
  })

  it('every page that says when the flag is written names each press that writes it, the band\'s among them', () => {
    for (const doc of ['README.md', 'plugin/README.md']) {
      const text = read(doc)
      // "only when you press Turn it on or Turn it off in /spin updates" leaves out the band's own button
      assert.doesNotMatch(text, /Turn it off\**\s+in `\/spin updates`/, `${doc} says only /spin updates writes`)
      assert.match(text, /only when (you press|the player presses) \**Turn it on\** or \**Turn it off\** \(in `\/spin updates`, or on Claude Desktop the band's \**Turn on auto-update\**\)/, doc)
    }
  })

  it('the environment names the docs and the site give are the ones the mod reads', () => {
    const names = envInSource()
    assert.deepEqual(names, [...UPDATE_ENV].sort(), 'the site privacy page lists exactly what plugin/hooks reads with $.env.get')
    const docs = {
      README: section(README, "What Spinlings can't read"),
      PRIVACY: section(PRIVACY, 'What the mod reads on your machine'),
      SPEC,
      CHANGELOG: read('CHANGELOG.md').split('\n## ')[1]!,
      'plugin/README.md': read('plugin/README.md'),
      'plugin/REVIEW.md': read('plugin/REVIEW.md'),
    }
    for (const [doc, text] of Object.entries(docs)) for (const name of names) assert.ok(text.includes(`\`${name}\``), `${doc} names ${name}`)
  })

  it('the README and PRIVACY.md say what is read, what is written and when, and that settings.json is never opened', () => {
    const lists = { README: section(README, "What Spinlings can't read"), PRIVACY: section(PRIVACY, 'What the mod reads on your machine') }
    for (const [doc, text] of Object.entries(lists)) {
      for (const want of ['known_marketplaces.json', '`settings.json`', '`/spin updates`', 'Turn it on', 'Turn it off', '`$.env.get`']) {
        assert.ok(text.includes(want), `${doc} says ${want}`)
      }
      assert.match(text, /`\$\.fs\.read`, `\$\.fs\.stat` and `\$\.fs\.write`|From `\$\.fs` it calls `read`, `stat` and `write`/, `${doc} lists the three file calls`)
      assert.doesNotMatch(text, /read and never written|never written or sent|read-only/, `${doc} still calls the plugin list read-only`)
    }
    const table = PRIVACY.slice(PRIVACY.indexOf('### On your computer'))
    assert.match(table, /\n\| What \| Read \| Written \|\n\|---\|---\|---\|\n/)
    assert.match(table, /\| Claude Code's plugin list, `known_marketplaces\.json` \| [^|]+ \| Only when you press \*\*Turn it on\*\* or \*\*Turn it off\*\*, and only the `spinlings` entry's `autoUpdate` switch \|/)
    assert.match(table, /\| Any `settings\.json`, yours or a project's \| Never opened \| Never \|/)
    assert.match(table, /\| Any other file or environment variable \| Never \| Never \|/)
    assert.ok(table.includes('Claude Code itself fetches the spinlings repository from GitHub when it starts'))
  })

  it('every page that lists the mod\'s $ calls names the writes and the environment reads, and settings stay untouched', () => {
    const spec12 = section(SPEC, '12. Security, privacy and supply chain (hard requirements)')
    for (const call of ['`fs.read`', '`fs.stat`', '`fs.write`', '`env.get`', '`$.settings`', '`$.env.set`']) assert.ok(spec12.includes(call), `SPEC 12 names ${call}`)
    assert.ok(read('plugin/REVIEW.md').includes('`$.fs.write` runs only on the player\'s press'))
    for (const doc of ['README.md', 'PRIVACY.md', 'SPEC.md', 'plugin/README.md', 'plugin/REVIEW.md', 'SECURITY.md']) {
      const text = read(doc)
      assert.match(text, /settings\.json/, `${doc} says settings.json is left alone`)
      assert.doesNotMatch(text, /opens one file, read-only|never writes or lists files|never touches files|never uses `\$\.process`, `\$\.model`, `\$\.prompt`, `\$\.tool`, `\$\.agent`, `\$\.mcp` or `\$\.env`/, `${doc} keeps an old claim`)
    }
  })

  it('SECURITY.md lists every part of the mod API the mod calls, and PRIVACY.md promises no more than the press does', () => {
    const security = read('SECURITY.md')
    for (const call of ['`plugin.root`', '`fs.read`', '`fs.stat`', '`fs.write`', '`env.get`']) assert.ok(security.includes(call), `SECURITY.md names ${call}`)
    // /spin version reads the list too, and the press puts the old text back only after a write that broke it
    assert.match(PRIVACY, /\| Claude Code's plugin list, `known_marketplaces\.json` \| [^|]*when you run `\/spin version`/)
    assert.doesNotMatch(PRIVACY, /puts the file back as it was|only while Claude Code is not saving it/)
    assert.match(PRIVACY, /If its own write leaves the file blank or unreadable, it writes the old text back\./)
    // the broken screen's way out, and the copy that would not work, as SPEC 32 words it
    const spec32 = section(SPEC, '32. Versioning and backward compatibility')
    assert.ok(spec32.includes('Delete known_marketplaces.json from this folder:'))
    assert.ok(spec32.includes('Copy folder'))
    assert.doesNotMatch(spec32, /Restart Claude Code; if Spinlings is gone/)
    assert.ok(spec32.includes('re-adding the same source keeps it'))
  })

  it('SPEC 32 describes the switch, and the commands list /spin updates', () => {
    const spec32 = section(SPEC, '32. Versioning and backward compatibility')
    const switchPart = spec32.slice(spec32.indexOf('### The update switch'), spec32.indexOf('### Numbers come from the server'))
    for (const want of ['`off-default`', '`off-chosen`', '`held`', '`autoupdate:mine`', '`autoupdate:pending`', '`<registry>.lock`', 'JSON.stringify(next, null, 2)', '500 ms', 'Enter alone never writes', 'A digit the band takes from the prompt never writes', '**Never touched:**']) {
      assert.ok(switchPart.includes(want), `The update switch covers ${want}`)
    }
    assert.ok(section(SPEC, '9. Surfaces').includes('`updates`'))
    const commands = section(README, 'How it plays')
    assert.ok(commands.includes('| `/spin updates` |'))
    assert.match(commands, /\| `\/spin version` \| [^|]*auto-update is on \|/)
    for (const doc of ['docs/compatibility.md', 'docs/releasing.md', 'docs/how-to-play.md']) assert.ok(read(doc).includes('/spin updates'), `${doc} points at /spin updates`)
  })

  it('the README points at /spin updates for update news, and at the site for every release', () => {
    assert.ok(README.includes("[What's new](https://spinlings.dev/whats-new)"), "the nav's What's new is the site's page")
    const commands = section(README, 'How it plays')
    assert.ok(commands.includes("| `/spin updates` | Whether you're up to date, what's new, and whether Spinlings updates by itself |"))
    assert.ok(README.includes("the pane's version chip opens `/spin updates`"))
    assert.doesNotMatch(README, /the pane offers an update/)
    // the source audit checks out the release players install
    assert.ok(README.includes(`git clone --branch v${CLIENT_VERSION} https://github.com/416rehman/spinlings\n`), `the audit clones v${CLIENT_VERSION}`)
  })

  it('releasing.md writes the release notes and announces a release only with its marketplace pin', () => {
    const releasing = read('docs/releasing.md')
    assert.ok(releasing.includes('`plugin/hooks/core/releases.ts`'), 'step 1 writes the RELEASES entry')
    assert.ok(releasing.includes('leave `LATEST_CLIENT` (`server/src/routes/account.ts`) at the previous release'))
    assert.ok(releasing.includes("It always equals the marketplace pin's `ref` without its `v`"))
    assert.ok(releasing.includes("In one commit, set the plugin entry's `source` in `.claude-plugin/marketplace.json` to the new tag and its commit, and `LATEST_CLIENT`"))
    assert.ok(releasing.includes('\n6b. **Deploy the server again from the pin commit,**'))
    for (const check of ['`latestClient`', '`notes[0].version`', 'https://spinlings.dev/whats-new']) assert.ok(releasing.includes(check), `step 6b checks ${check}`)
    assert.ok(releasing.includes('point the marketplace entry back at the previous tag and its commit and set `LATEST_CLIENT` back to that release; deploy the server'))
    assert.ok(releasing.includes('only as the last change to `plugin/hooks/core/schemas.ts` before it'), 'fixtures are re-recorded last')
    // claude plugin update refreshes the marketplace itself, so the extra command adds nothing
    assert.doesNotMatch(releasing, /claude plugin marketplace update/)
    const spec32 = section(SPEC, '32. Versioning and backward compatibility')
    assert.ok(spec32.includes('`LATEST_CLIENT` always equals the marketplace pin'))
    assert.ok(spec32.includes('notes?: ReleaseNote[]'), 'the handshake shape lists notes')
    assert.ok(spec32.includes('the next time Claude Code starts'))
    assert.doesNotMatch(spec32, /after your next start|update row|Hide update/)
  })

  it('PRIVACY.md names what the update news keeps, and that the version check sends nothing new', () => {
    const keeps = section(PRIVACY, 'What the mod keeps on your machine')
    // the keys the words name, as the mod writes them
    assert.equal(KEYS.release, 'release')
    assert.equal(KEYS.notes('https://spinlings.dev'), 'server:https://spinlings.dev:notes')
    assert.ok(keeps.includes('`release`'), 'PRIVACY names the release record')
    assert.ok(keeps.includes('`notes` key'), 'PRIVACY names the stored notes')
    const sends = section(PRIVACY, 'What the mod sends')
    assert.ok(sends.includes("The daily version check, `GET /v1/version`, sends nothing new: its answer also carries the newest releases' notes, which the mod keeps only from spinlings.dev."))
    assert.ok(section(PRIVACY, 'Changes').includes('\n- **0.3.0 (2026-11-10).**'))
  })

  it('what players are told about an old version is in plain words, never read-only', () => {
    const docs = { README, CHANGELOG: read('CHANGELOG.md').split('\n## ')[1]!, 'docs/how-to-play.md': read('docs/how-to-play.md'), 'plugin/README.md': read('plugin/README.md') }
    for (const [doc, text] of Object.entries(docs)) assert.doesNotMatch(text, /read-only on|is read-only|plays? read-only/i, `${doc} calls an old version read-only`)
  })
})

// Marketplace installs must contain the player runtime, without internal SDK suites or UI-review fixtures.
import assert from 'node:assert/strict'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCommand, USAGE } from '../../plugin/hooks/client/commands.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

describe('the installed plugin excludes maintainer QA', () => {
  it('the actual marketplace subdirectory contains no test suites, scene fixtures or SDK testing imports', () => {
    const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')) as {
      plugins: { name: string; source: { path: string } }[]
    }
    const entry = marketplace.plugins.find(plugin => plugin.name === 'spinlings')
    assert.ok(entry, 'The marketplace must identify the installed Spinlings payload')
    const payload = resolve(ROOT, entry.source.path)
    assert.ok(payload.startsWith(resolve(ROOT) + sep), 'The installed payload must stay inside the repository')
    const files = readdirSync(payload, { recursive: true }).filter(name => {
      const info = lstatSync(join(payload, String(name)))
      assert.ok(!info.isSymbolicLink(), 'The installed payload cannot link to internal test sources')
      return info.isFile()
    }).map(name => String(name).replaceAll('\\', '/'))
    assert.ok(files.includes('.claude-plugin/plugin.json'), 'The checked directory must be an installable plugin')
    for (const file of files) {
      assert.doesNotMatch(file, /(?:^|\/)(?:tests?|fixtures)(?:\/|$)/i, `${file}: internal test directory in the installed payload`)
      assert.doesNotMatch(file, /\.(?:test|sdk)\.[cm]?[jt]sx?$/i, `${file}: internal test suite in the installed payload`)
      assert.doesNotMatch(file, /(?:^|\/)(?:demo|ui-scenes)\.[cm]?[jt]sx?$/i, `${file}: internal scene module in the installed payload`)
      if (/\.[cm]?[jt]sx?$/.test(file)) {
        const source = readFileSync(join(payload, file), 'utf8')
        assert.doesNotMatch(source, /['"]claude-code\/testing['"]/, `${file}: runtime imports the SDK test API`)
        assert.doesNotMatch(source, /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["'][^"']*\/test\/plugin\//,
          `${file}: runtime imports the internal UI-review fixtures`)
      }
    }
  })

  it('internal demo requests are unsupported and player help does not advertise them', () => {
    assert.doesNotMatch(USAGE, /^\/spin\s+demo\b/im)
    assert.equal(parseCommand('help').kind, 'help')
    for (const args of ['demo', 'DEMO', 'demo next', 'demo 1']) {
      const result = parseCommand(args)
      assert.equal(result.kind, 'help', `${args}: a QA request must not open a player view`)
      if (result.kind === 'help') assert.match(result.text, /^There is no \/spin demo\./i)
    }
  })
})

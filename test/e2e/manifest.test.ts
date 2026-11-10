// The pieces agree on what they are: one version across the mod and its manifest, a server that announces none
// newer, and the mod's hooks and `$` calls inside the SPEC 12 lists, as `claude plugin validate --json` reports them.
// Set SPINLINGS_CLAUDE to a Claude Code binary with `plugin validate --json` (else `claude` on PATH);
// the validator check is skipped when none is found.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CLIENT_VERSION, compareSemver } from '../../plugin/hooks/client/remote.ts'
import { MIN_CLIENT } from '../../server/src/app.ts'
import { LATEST_CLIENT } from '../../server/src/routes/account.ts'

const PLUGIN = fileURLToPath(new URL('../../plugin', import.meta.url))
const manifest = JSON.parse(readFileSync(`${PLUGIN}/.claude-plugin/plugin.json`, 'utf8')) as { version: string }

describe('versions', () => {
  it('the mod and its manifest name the same release, and the server announces none newer', () => {
    assert.equal(CLIENT_VERSION, manifest.version, 'client/remote.ts CLIENT_VERSION is plugin.json version')
    // the server announces a release only once the marketplace pins it (test/release/marketplace.test.ts), so until the
    // pin commit it still names the one before
    assert.ok(compareSemver(LATEST_CLIENT, manifest.version) <= 0, `the server announces ${LATEST_CLIENT}, never a mod past this one`)
    assert.ok(compareSemver(MIN_CLIENT, CLIENT_VERSION) <= 0, 'the server takes this mod')
  })
})

type Report = { contents: { notes: string[] }[] }

function validate(bin: string): Promise<Report | null> {
  return new Promise(done => {
    execFile(bin, ['plugin', 'validate', '--json', PLUGIN], { timeout: 120_000, windowsHide: true }, (_err, stdout) => {
      try {
        done(JSON.parse(stdout) as Report)
      } catch {
        done(null)
      }
    })
  })
}

describe('the validator\'s view of the mod (SPEC 2, 10, 12)', () => {
  it('hooks only session signals, and calls only the allowed $ nouns', { timeout: 150_000 }, async t => {
    const report = await validate(process.env.SPINLINGS_CLAUDE || 'claude')
    if (!report) return t.skip('no claude binary with `plugin validate --json` (set SPINLINGS_CLAUDE)')
    const notes = report.contents.flatMap(c => c.notes)
    const line = (label: string) => notes.find(n => n.includes(` ${label}: `))?.split(`${label}: `)[1] ?? ''
    const hooks = line('hooks').split(/,\s*(?![^{]*})/).map(h => h.trim().replace(/\{.*$/, ''))
    assert.ok(hooks.length > 0, 'the validator listed the hooks')
    for (const never of ['agent.spawn', 'tool.call', 'prompt.submit', 'classic.PermissionRequest']) assert.ok(!hooks.includes(never), `never hooks ${never}`)
    const listed = line('calls')
    const calls = [...listed.matchAll(/\$\.(\w+)\.(\w+)/g)].map(m => [m[1]!, m[2]!] as const)
    assert.ok(calls.length > 0, 'the validator listed the $ calls')
    // SPEC 12's nouns, plus audio for the chimes (SPEC 13.12), Claude Code's plugin registry and the variables that say
    // whether its update pass runs (SPEC 32)
    const allowed = new Set(['ui', 'state', 'store', 'clock', 'command', 'http', 'session', 'audio', 'fs', 'env'])
    for (const [noun, method] of calls) {
      assert.ok(allowed.has(noun), `$.${noun} is not an allowed noun`)
      if (noun === 'fs') assert.ok(['read', 'stat', 'write'].includes(method), `$.fs.${method} is never called`)
      if (noun === 'env') assert.equal(method, 'get', `$.env.${method} is never called`)
      if (noun === 'session') assert.ok(['model', 'version', 'surfaces', 'usage'].includes(method), `$.session.${method} is never called (SPEC 20.1)`)
    }
    // the one write goes through the switch's file and nowhere else
    assert.match(listed, /\$\.fs\.write \(via registryFile\)(,|$)/)
    assert.doesNotMatch(listed, /\$\.settings\./)
    assert.equal(line('env writes'), 'nothing')
    assert.deepEqual(line('env reads').split(/,\s*/).sort(), [
      'CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_AUTOUPDATER', 'DISABLE_UPDATES', 'FORCE_AUTOUPDATE_PLUGINS',
    ])
  })
})

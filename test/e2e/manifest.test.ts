// The pieces agree on what they are: one version across the mod, its manifest and the server, and the
// mod's hooks and `$` calls inside the SPEC 12 lists, as `claude plugin validate --json` reports them.
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
  it('the mod, its manifest and the server name the same release', () => {
    assert.equal(CLIENT_VERSION, manifest.version, 'client/remote.ts CLIENT_VERSION is plugin.json version')
    assert.equal(LATEST_CLIENT, manifest.version, 'the server announces this release as the latest mod')
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
    for (const never of ['tool.call', 'prompt.submit', 'classic.PermissionRequest']) assert.ok(!hooks.includes(never), `never hooks ${never}`)
    const calls = [...line('calls').matchAll(/\$\.(\w+)\.(\w+)/g)].map(m => [m[1]!, m[2]!] as const)
    assert.ok(calls.length > 0, 'the validator listed the $ calls')
    // SPEC 12's nouns, plus audio for the chimes (SPEC 13.12)
    const allowed = new Set(['ui', 'state', 'store', 'clock', 'command', 'http', 'session', 'audio'])
    for (const [noun, method] of calls) {
      assert.ok(allowed.has(noun), `$.${noun} is not an allowed noun`)
      if (noun === 'session') assert.ok(['model', 'version', 'surfaces', 'usage'].includes(method), `$.session.${method} is never called (SPEC 20.1)`)
    }
  })
})

// The marketplace installs one released commit, never a branch (SPEC 12, docs/releasing.md step 5): a `v*` tag, and
// once that tag exists, its exact commit as `sha`, so moving or recreating a tag changes nothing anyone installs.
// The one exception is the release commit itself, which cannot name its own sha. CI fetches tags for this check.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareSemver } from '../../plugin/hooks/client/remote.ts'
import { SERVER_VERSION } from '../../server/src/routes/account.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const json = (path: string) => JSON.parse(readFileSync(ROOT + path, 'utf8'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const commitOf = (ref: string) => {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
  } catch {
    return null
  }
}

type Source = { source: string; url: string; path: string; ref: string; sha?: string }

it('the marketplace entry is pinned to a release tag and, once it exists, to its commit', () => {
  const market = json('.claude-plugin/marketplace.json') as { name: string; plugins: { name: string; source: Source }[] }
  const plugin = json('plugin/.claude-plugin/plugin.json') as { name: string; version: string }
  assert.equal(market.plugins.length, 1)
  const [entry] = market.plugins
  assert.equal(entry!.name, plugin.name)
  const { source, url, path, ref, sha, ...rest } = entry!.source
  assert.deepEqual(rest, {}, 'no other source fields')
  assert.equal(source, 'git-subdir')
  assert.equal(url, 'https://github.com/416rehman/spinlings.git')
  assert.equal(path, 'plugin')
  assert.match(ref, /^v\d+\.\d+\.\d+$/, 'a release tag, never a branch')
  assert.ok(compareSemver(ref.slice(1), plugin.version) <= 0, 'the entry never points past the plugin version')
  if (sha !== undefined) assert.match(sha, /^[0-9a-f]{40}$/, 'a full lowercase commit sha')

  const tagged = commitOf(`refs/tags/${ref}`)
  if (tagged === null) {
    // before the first release there is nothing to pin; CI clones with every tag, so there the tag must be found
    if (sha !== undefined && process.env.CI) assert.fail(`${ref} is pinned but this clone has no such tag`)
    return
  }
  if (sha === undefined && tagged === commitOf('HEAD')) return
  assert.equal(sha, tagged, `the entry pins ${ref} to its commit (docs/releasing.md step 5)`)
})

it('a release tag deploys the server as that same version (the deploy checks /v1/version against the tag)', () => {
  assert.equal(SERVER_VERSION, json('plugin/.claude-plugin/plugin.json').version)
})

// SDK tests stay in the repository; the installable plugin contains only its runtime.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const plugin = join(root, 'plugin'), tests = join(root, 'test/plugin')
const privateDir = join(root, '.dev')
mkdirSync(privateDir, { recursive: true })
assert.ok(lstatSync(privateDir).isDirectory() && !lstatSync(privateDir).isSymbolicLink(), 'SDK staging must use a workspace directory')
const staged = mkdtempSync(join(privateDir, 'sdk-plugin-'))
assert.ok(resolve(staged).startsWith(resolve(privateDir) + sep), 'SDK staging must stay inside the workspace')

function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true }).map(name => String(name)).filter(name => {
    const entry = lstatSync(join(directory, name))
    assert.ok(!entry.isSymbolicLink(), 'SDK sources must contain plain files and directories')
    return entry.isFile()
  }).sort()
}

const runtime = new Map(files(plugin).map(name => [name, readFileSync(join(plugin, name))]))
assert.ok(runtime.size > 0 && runtime.has(join('.claude-plugin', 'plugin.json')), 'The installable plugin is missing')
assert.ok(![...runtime.keys()].some(name => name === 'tests' || name.startsWith('tests' + sep)), 'SDK tests must remain outside the installable plugin')
cpSync(plugin, staged, { recursive: true })
assert.deepEqual(files(staged), [...runtime.keys()], 'The staging copy must contain every runtime file and no extras')
const verify = () => {
  for (const [name, bytes] of runtime) assert.ok(bytes.equals(readFileSync(join(staged, name))), 'The SDK runtime copy must remain byte-identical')
}
verify()

const sources = files(tests), suites = sources.filter(name => name.endsWith('.sdk.ts'))
assert.ok(suites.length > 0, 'The SDK suite must contain tests')
for (const name of sources) {
  assert.match(name, /\.tsx?$/, 'SDK sources must be TypeScript')
  const dest = join(staged, 'tests', name.replace(/\.sdk\.ts$/, '.test.ts'))
  assert.ok(relative(staged, dest).startsWith('tests' + sep))
  mkdirSync(dirname(dest), { recursive: true })
  const source = readFileSync(join(tests, name), 'utf8')
  // Only copied test import specifiers change; runtime files and repository tests never do.
  const relocated = source.replace(/(\bfrom\s+['"]|\bimport\s+['"]|\bimport\s*\(\s*['"])\.\.\/\.\.\/plugin\//g, '$1../')
  writeFileSync(dest, relocated)
}

const result = spawnSync(process.env.SPINLINGS_CLAUDE || 'claude', ['plugin', 'test', staged], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024,
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
verify()
const output = ((result.stdout || '') + (result.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '')
const summary = output.match(/\bRan (\d+) tests across (\d+) files\./)
const passed = output.match(/^\s*(\d+) pass\s*$/m)
const complete = summary && passed && Number(summary[1]) > 0 && Number(summary[1]) === Number(passed[1]) && Number(summary[2]) === suites.length
const valid = complete && /^\s*0 fail\s*$/m.test(output) && !/\(skip\)|\b[1-9]\d* skip\b|hook.*(?:budget|timed out)/i.test(output)
if (result.status !== 0 || !valid) {
  console.error('The complete SDK suite must execute against the unchanged runtime with zero failures, skips or hook timeouts. Set SPINLINGS_CLAUDE to a compatible Claude Code executable if it could not start.')
  process.exitCode = result.status && result.status > 0 ? result.status : 1
} else console.log(`SDK staging verified: ${runtime.size} unchanged runtime files; ${suites.length} suites executed. Temporary files remain ignored inside .dev.`)

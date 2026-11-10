// The content-blind guarantee (SPEC 2, 10, 12), read straight from the mod's source with no Claude Code needed:
// the exact hook list, the allowed `$` nouns, and the only event fields register.tsx reads. A change here must update
// SPEC 10, the README's "What Spinlings can't read" and PRIVACY.md in the same pull request. test/e2e/manifest.test.ts
// checks the same lists as `claude plugin validate --json` reports them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HOOKS as PRIVACY_HOOKS } from '../../plugin/hooks/client/viewmodels.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOOKS_DIR = fileURLToPath(new URL('../../plugin/hooks/', import.meta.url))
/** A source as git keeps it (.gitattributes: eol=lf), whatever line endings a checkout gave it. */
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const register = read(`${HOOKS_DIR}register.tsx`)

const sources = (readdirSync(HOOKS_DIR, { recursive: true }) as string[])
  .filter(f => /\.tsx?$/.test(f))
  .map(f => ({ file: f.replaceAll('\\', '/'), text: read(HOOKS_DIR + f) }))

const HOOKS = [
  'session.start', 'classic.SessionStart', 'session.end', 'turn.start', 'turn.step', 'turn.complete',
  'session.measure', 'session.compact', 'command.run', 'ui.close', 'ui.render', 'ui.message',
]

const NOUNS = new Set(['ui', 'state', 'store', 'clock', 'command', 'http', 'session', 'audio', 'fs', 'plugin', 'env'])
/** nouns whose every method is pinned: identity, the network, sound, the one file, and the environment, read only */
const METHODS: Record<string, string[]> = {
  session: ['model'],
  http: ['fetch'],
  audio: ['play'],
  command: ['register'],
  fs: ['read', 'stat', 'write'],
  plugin: ['root'],
  env: ['get'],
}
/** The variables Claude Code's plugin update pass reads (client/autoupdate.ts updatesHeldBy), and no other. */
const ENV = ['DISABLE_UPDATES', 'DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'FORCE_AUTOUPDATE_PLUGINS', 'CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST']
const SWITCH = read(`${HOOKS_DIR}client/autoswitch.ts`)
/** register.tsx's lending of the file to the switch, from its head to the end of its body */
const lend = register.slice(register.indexOf('function registryFile('), register.indexOf('\n}\n', register.indexOf('function registryFile(')))

/** Every event field register.tsx may read (SPEC 10), as `e.<path>`. */
const FIELDS = new Set([
  'agentId', 'model', 'effort', 'reason', 'rateLimits', 'trigger', 'args', 'origin.kind', 'surface', 'requestId', 'element', 'data',
  'props.hasSurvey', 'props.bodyColumns', 'props.maxRows', 'props.isWorking', 'props.scroll.bodyRows', 'props.isFocused',
  'props.placement', 'props.suffix', 'props.mode',
])

// Recognize only the plain callback signatures this module uses. A different signature must be reviewed rather
// than silently escaping the content-blind check when its event parameter has a different name.
const hookHeads = [...register.matchAll(/\bon\(\s*(['"`])([\w.]+)\1/g)]
const callbacks = [...register.matchAll(/\bon\(\s*(['"`])([\w.]+)\1\s*,\s*(?:\{[^{}]*\}\s*,\s*)?async\s+(?:function\s*\*\s*)?\(\s*\$\s*,\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\)/g)]
const eventBindings = [...new Set(callbacks.map(m => m[3]!))]
const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('the content-blind allowlist (SPEC 10, 12)', () => {
  it('the mod is one module, register.tsx', () => {
    assert.deepEqual(JSON.parse(readFileSync(`${HOOKS_DIR}hooks.json`, 'utf8')), { modules: ['./register.tsx'] })
  })

  it('the privacy pane lists the exact active hooks', () => {
    assert.deepEqual([...PRIVACY_HOOKS].sort(), [...HOOKS].sort())
  })

  it('register.tsx registers exactly the SPEC 10 hooks, and never agent.spawn, tool.call, prompt.submit or a permission hook', () => {
    const hooks = [...register.matchAll(/\bon\(\s*(['"`])([\w.]+)\1/g)].map(m => m[2]!)
    assert.deepEqual([...new Set(hooks)].sort(), [...HOOKS].sort())
    for (const { file, text } of sources) {
      assert.doesNotMatch(text, /['"`](agent\.spawn|tool\.call|prompt\.submit|classic\.Permission\w*|classic\.UserPromptSubmit|classic\.PreToolUse|classic\.PostToolUse)['"`]/, file)
    }
  })

  it('uses only the allowed $ nouns, and from session only the model', () => {
    for (const { file, text } of sources) {
      assert.doesNotMatch(text, /\$\s*\[/, `${file}: $ is never indexed`)
      for (const m of text.matchAll(/(?<![\w$])\$\.(\w+)(?:\.(\w+))?/g)) {
        const [, noun, method] = m
        assert.ok(NOUNS.has(noun!), `${file}: $.${noun} is not an allowed noun`)
        if (method && METHODS[noun!]) assert.ok(METHODS[noun!]!.includes(method), `${file}: $.${noun}.${method} is not allowed`)
      }
      assert.doesNotMatch(text, /\$\.session\.(authorize|id|repo)\b/, `${file}: never names the session or the user (SPEC 20.1)`)
    }
  })

  it('the one file it opens is the plugin registry of Claude Code, at the path client/autoupdate.ts allows, and only it', () => {
    const calls = sources.flatMap(({ file, text }) => [...text.matchAll(/(?<![\w$])\$\.(fs|plugin)\.\w+[^\n]*/g)].map(m => `${file}: ${m[0]}`))
    assert.deepEqual(calls, [
      'register.tsx: $.plugin.root)',
      'register.tsx: $.fs.read(path)',
      'register.tsx: $.plugin.root)',
      'register.tsx: $.fs.stat(path)',
      'register.tsx: $.fs.stat(`${path}.lock`)',
      'register.tsx: $.fs.read(path, { as: \'bytes\' })).base64,',
      'register.tsx: $.fs.write(path, text),',
      // the folder the guide names when a write left the list unreadable: the same derivation, and no call into $.fs
      'register.tsx: $.plugin.root) : null',
    ])
    assert.match(register, /\n\s*const folder = file \? registryFolder\(\$\.plugin\.root\) : null\n/)
    // both functions take the path from registryPath alone and give up without one
    assert.equal([...register.matchAll(/const path = registryPath\(\$\.plugin\.root\)\n\s*if \(!path\) return null\n/g)].length, 2)
    assert.match(register, /const path = registryPath\(\$\.plugin\.root\)\n\s*if \(!path\) return null\n\s*try \{\n\s*return await \$\.fs\.read\(path\)/)
    assert.doesNotMatch(register, /\$\.fs\.(list|exists|ancestors)/)
    assert.doesNotMatch(register, /\blet path\b|\bpath\s*\+=/)
  })

  it('exactly one $.fs.write in the mod: register.tsx\'s, to the registryPath path, lent only to the switch', () => {
    const writes = sources.flatMap(({ file, text }) => [...text.matchAll(/\$\.fs\.write\(/g)].map(() => file))
    assert.deepEqual(writes, ['register.tsx'])
    assert.match(lend, /^function registryFile\(\$: Engine\): RegistryFile \| null \{\n\s*const path = registryPath\(\$\.plugin\.root\)\n\s*if \(!path\) return null\n/)
    assert.match(lend, /write: text => \$\.fs\.write\(path, text\),/)
    // the file is only ever named by that one path: no other string reaches stat, read or write
    const named = [...lend.matchAll(/\$\.fs\.(\w+)\(([^,)]+)/g)].map(m => `${m[1]} ${m[2]}`)
    assert.deepEqual(named, ['stat path', 'stat `${path}.lock`', 'read path', 'write path'])
    // only the switch writes through what it is lent; the game hands it on and never writes itself
    const holders = sources.filter(({ text }) => /\bregistryFile\b/.test(text)).map(s => s.file).sort()
    assert.deepEqual(holders, ['client/game.ts', 'client/types.ts', 'register.tsx'])
    assert.match(SWITCH, /await io\.file\.write\(text\)/)
    for (const { file, text } of sources) if (file !== 'client/autoswitch.ts') assert.doesNotMatch(text, /\.file\.write\(|\bfile\.write\(/, file)
  })

  it('the game hands the list\'s text to autoUpdateOf alone and drops it at once; nothing else asks for it', () => {
    const game = sources.find(s => s.file === 'client/game.ts')!.text
    const head = game.indexOf('  async function readAutoUpdate(fx: Fx): Promise<AutoUpdate> {\n')
    assert.ok(head > 0)
    const body = game.slice(head, game.indexOf('\n  }\n', head))
    // the exact lines: read, reduce to the flag, forget
    assert.ok(body.includes([
      '    let text: string | null = null',
      '    try {',
      '      text = fx.registry ? await fx.registry() : null',
      '    } catch {',
      '      text = null',
      '    }',
      '    const state = autoUpdateOf(text)',
      '    text = null',
    ].join('\n')), 'readAutoUpdate reads the text, reduces it to the flag and drops it')
    // `text` is named nowhere else in the function: never stored, logged, sent or kept
    assert.equal([...body.matchAll(/\btext\b/g)].length, 5)
    // and only there is the list's text asked for (`fx.registry ? await fx.registry()`), and only fxOf lends it
    const asks = sources.flatMap(({ file, text }) => [...text.matchAll(/\.registry\b/g)].map(() => file))
    assert.deepEqual(asks, ['client/game.ts', 'client/game.ts'])
    assert.equal([...body.matchAll(/\.registry\b/g)].length, 2)
    assert.deepEqual(sources.flatMap(({ file, text }) => [...text.matchAll(/\bregistry\(\$\)/g)].map(() => file)), ['register.tsx'])
  })

  it('never opens settings.json and never calls $.settings', () => {
    for (const { file, text } of sources) {
      assert.doesNotMatch(text, /\$\.settings\b/, file)
      assert.doesNotMatch(text, /settings(\.local)?\.json/, file)
      assert.doesNotMatch(text, /['"`]settings\.read['"`]/, file)
    }
  })

  it('reads the environment only by the literal names Claude Code\'s update pass reads, and never sets it', () => {
    const reads: string[] = []
    for (const { file, text } of sources) {
      assert.doesNotMatch(text, /\$\.env\.set\b/, file)
      for (const m of text.matchAll(/\$\.env\.(\w+)\(([^)]*)\)/g)) {
        assert.equal(file, 'register.tsx', `${file} reads the environment`)
        assert.equal(m[1], 'get')
        assert.match(m[2]!, /^'[A-Z_]+'$/, `$.env.get(${m[2]}) takes a literal name`)
        reads.push(m[2]!.slice(1, -1))
      }
    }
    assert.deepEqual(reads.sort(), [...ENV].sort())
  })

  it('the switch module logs nothing, sends nothing, and its catch blocks keep at most the OS code', () => {
    assert.doesNotMatch(SWITCH, /\$\.|\bfetch\b|\bconsole\b|\.log\(|\.toast\(|\.status\(|\bthrow\b|\.message\b|\.stack\b/)
    assert.doesNotMatch(SWITCH, /import [^\n]*from '\.\/(game|remote|net|types)\.ts'/)
    const catches = [...SWITCH.matchAll(/catch\s*(?:\((\w+)\))?\s*\{([^}]*)\}/g)]
    assert.ok(catches.length >= 4)
    for (const [, name, body] of catches) {
      if (!name) continue
      // the binding is only ever handed to codeOf, which reads e?.code
      const uses = [...body!.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length
      const viaCode = [...body!.matchAll(new RegExp(`codeOf\\(${name}\\)`, 'g'))].length
      assert.equal(uses, viaCode, `catch (${name}) reads only its code`)
    }
    assert.match(SWITCH, /function codeOf\(e: unknown\): string \{\n\s*const code = \(e as \{ code\?: unknown \} \| null \| undefined\)\?\.code\n/)
    // register.tsx's helpers for the switch keep nothing of a failure at all
    assert.doesNotMatch(lend, /catch\s*\(/)
  })

  it('the pages shipped inside the mod say it writes the plugin list only on a press, and never that it never writes', () => {
    for (const doc of ['plugin/README.md', 'plugin/REVIEW.md']) {
      const text = read(ROOT + doc)
      assert.match(text, /Turn it on/, `${doc} names the press that writes`)
      assert.doesNotMatch(text, /never writes|read-only|one file, read/i, `${doc} claims the mod never writes`)
    }
  })

  it('every page that says what the mod reads names the one file it opens, and none claims it opens no file', () => {
    // plugin/README.md and plugin/REVIEW.md ship inside the installed plugin: they are what users and reviewers read
    for (const doc of ['plugin/README.md', 'plugin/REVIEW.md', 'README.md', 'PRIVACY.md', 'SPEC.md']) {
      const text = read(ROOT + doc)
      assert.match(text, /plugin list/, `${doc} names Claude Code's plugin list`)
      assert.doesNotMatch(text, /no filesystem|never reads (or sends )?files|never reads (or sends )?[\w ,]*(?<!your )files/i, `${doc} claims the mod reads no file`)
    }
  })

  it('register.tsx reads only the shape of the session from its events', () => {
    assert.equal(callbacks.length, hookHeads.length, 'every registered hook must have an unambiguously checked event binding')
    const reads: string[] = []
    for (const name of eventBindings) {
      const token = `(?<![\\w$])${escaped(name)}`
      assert.doesNotMatch(register, new RegExp(`${token}\\s*\\[`), 'event fields are read by name')
      assert.doesNotMatch(register, new RegExp(`\\}\\s*=\\s*${token}(?![\\w$])`), 'events are never destructured')
      // Passing the spinner's props on to next leaves them unread.
      const source = register.replaceAll(`...${name}.props`, '')
      const fields = [...source.matchAll(new RegExp(`${token}\\.((?:\\w+\\.)*\\w+)`, 'g'))].map(m => m[1]!)
      reads.push(...fields)
      for (const path of fields) assert.ok(FIELDS.has(path), `register.tsx reads ${name}.${path}`)
    }
    assert.ok(reads.length > 0)
  })

  it('the composer launcher composes Claude\'s drawing without reading modes, prompt hint or draft content', () => {
    assert.match(register, /on\('ui\.render', \{ component: 'PromptHint' \}/)
    assert.match(register, /on\('ui\.render', \{ component: 'SessionMode' \}/)
    for (const name of eventBindings) assert.doesNotMatch(register, new RegExp(`(?<![\\w$])${escaped(name)}\\.props\\.(modes|hint|tail|isDraft)\\b`))
  })
})

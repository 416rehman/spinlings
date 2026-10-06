// The content-blind guarantee (SPEC 2, 10, 12), read straight from the mod's source with no Claude Code needed:
// the exact hook list, the allowed `$` nouns, and the only event fields register.tsx reads. A change here must update
// SPEC 10, the README's "What Spinlings can't read" and PRIVACY.md in the same pull request. test/e2e/manifest.test.ts
// checks the same lists as `claude plugin validate --json` reports them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HOOKS as PRIVACY_HOOKS } from '../../plugin/hooks/client/viewmodels.ts'

const HOOKS_DIR = fileURLToPath(new URL('../../plugin/hooks/', import.meta.url))
const register = readFileSync(`${HOOKS_DIR}register.tsx`, 'utf8')

const sources = (readdirSync(HOOKS_DIR, { recursive: true }) as string[])
  .filter(f => /\.tsx?$/.test(f))
  .map(f => ({ file: f.replaceAll('\\', '/'), text: readFileSync(HOOKS_DIR + f, 'utf8') }))

const HOOKS = [
  'session.start', 'classic.SessionStart', 'session.end', 'turn.start', 'turn.step', 'turn.complete',
  'session.measure', 'session.compact', 'command.run', 'ui.close', 'ui.render', 'ui.message',
]

const NOUNS = new Set(['ui', 'state', 'store', 'clock', 'command', 'http', 'session', 'audio'])
/** nouns whose every method is pinned: identity, the network and sound */
const METHODS: Record<string, string[]> = {
  session: ['model'],
  http: ['fetch'],
  audio: ['play'],
  command: ['register'],
}

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

// Lets plain Node import the mod's .tsx views: JSX through jsx.ts, then Node's own type stripping. Import this before
// any .tsx module is loaded (the entry imports it statically and everything else dynamically).
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compileJsx } from './jsx.ts'

const H = 'const __h = (type, props, ...children) => ({ type, props: props ?? {}, children });\n'

registerHooks({
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return next(url, context)
    const src = readFileSync(fileURLToPath(url), 'utf8')
    const js = stripTypeScriptTypes(compileJsx(src), { mode: 'transform' })
    return { format: 'module', source: H + js, shortCircuit: true }
  },
})

process.removeAllListeners('warning')
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w) })

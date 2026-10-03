// A small JSX compiler, so the media scripts can import the mod's own .tsx views on plain Node (which strips types
// but has no JSX). Every element becomes `__h(type, props, ...children)`: intrinsic names become strings, `el.Box` and
// `Box` stay expressions. It only has to read this repo's views, so it handles what they use: elements and fragments,
// string and expression attributes, attribute and child spreads, text, and JSX nested in expressions.

const REGEX_BEFORE = new Set([...'(,=:[!&|?{};+-*%<>~^'])
const JSX_BEFORE = new Set([...'(,=?:[{};&|!'])
const KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'yield', 'await', 'void'])

type Out = { s: string; i: number }

export function compileJsx(src: string): string {
  return code(src, 0, false).s
}

function code(src: string, start: number, untilBrace: boolean): Out {
  let s = ''
  let i = start
  let depth = 0
  let last = ''
  let word = ''
  let joined = false
  const note = (chunk: string) => {
    const t = chunk.trimEnd()
    if (!t) return
    last = t[t.length - 1]!
    const m = /[A-Za-z_$][\w$]*$/.exec(t)
    word = m ? m[0] : ''
    joined = false
  }
  while (i < src.length) {
    const c = src[i]!
    if (c === '}' && untilBrace && depth === 0) return { s, i }
    if (c === '{') depth++
    if (c === '}') depth--
    if (c === '"' || c === "'") {
      const end = stringEnd(src, i)
      s += src.slice(i, end)
      note(src.slice(i, end))
      i = end
      continue
    }
    if (c === '`') {
      let t = '`'
      i++
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { t += src.slice(i, i + 2); i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '{') {
          const inner = code(src, i + 2, true)
          t += '${' + inner.s + '}'
          i = inner.i + 1
          continue
        }
        t += src[i]
        i++
      }
      s += t + '`'
      i++
      note('`')
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      const stop = end < 0 ? src.length : end
      s += src.slice(i, stop)
      i = stop
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const stop = src.indexOf('*/', i + 2) + 2
      s += src.slice(i, stop)
      i = stop
      continue
    }
    if (c === '/' && (last === '' || REGEX_BEFORE.has(last) || KEYWORDS.has(word))) {
      const end = regexEnd(src, i)
      s += src.slice(i, end)
      note(src.slice(i, end))
      i = end
      continue
    }
    if (c === '<' && /[A-Za-z>]/.test(src[i + 1] ?? '') && (last === '' || JSX_BEFORE.has(last) || KEYWORDS.has(word) || (last === '>' && /=>\s*$/.test(s)))) {
      const el = element(src, i)
      s += el.s
      i = el.i
      last = ')'
      word = ''
      continue
    }
    s += c
    if (/[\w$]/.test(c)) {
      word = joined ? word + c : c
      last = c
      joined = true
    } else {
      joined = false
      if (!/\s/.test(c)) { last = c; word = '' }
    }
    i++
  }
  if (untilBrace) throw new SyntaxError('jsx: unclosed {')
  return { s, i }
}

function stringEnd(src: string, i: number): number {
  const q = src[i]
  let j = i + 1
  while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1
  return j + 1
}

function regexEnd(src: string, i: number): number {
  let j = i + 1
  let cls = false
  while (j < src.length) {
    const c = src[j]!
    if (c === '\\') { j += 2; continue }
    if (c === '[') cls = true
    else if (c === ']') cls = false
    else if (c === '/' && !cls) break
    else if (c === '\n') throw new SyntaxError(`jsx: unterminated regex at ${i}`)
    j++
  }
  j++
  while (/[a-z]/.test(src[j] ?? '')) j++
  return j
}

const ws = (src: string, i: number) => { while (/\s/.test(src[i] ?? '')) i++; return i }

/** One element from its `<` to the end of its closing tag. */
function element(src: string, start: number): Out {
  let i = start + 1
  let tag = 'null'
  let name = ''
  if (src[i] === '>') {
    i++
  } else {
    name = /^[A-Za-z_$][\w$.-]*/.exec(src.slice(i))![0]
    i += name.length
    tag = /^[a-z][\w-]*$/.test(name) ? JSON.stringify(name) : name
  }
  const props: string[] = []
  let closed = false
  if (name) {
    for (;;) {
      i = ws(src, i)
      if (src.startsWith('/>', i)) { i += 2; closed = true; break }
      if (src[i] === '>') { i++; break }
      if (src[i] === '{') {
        i = ws(src, i + 1)
        if (!src.startsWith('...', i)) throw new SyntaxError(`jsx: expected a spread at ${i}`)
        const e = code(src, i + 3, true)
        props.push(`...(${e.s})`)
        i = e.i + 1
        continue
      }
      const attr = /^[\w$:-]+/.exec(src.slice(i))
      if (!attr) throw new SyntaxError(`jsx: bad attribute at ${i} in <${name}>`)
      i = ws(src, i + attr[0].length)
      let value = 'true'
      if (src[i] === '=') {
        i = ws(src, i + 1)
        if (src[i] === '"' || src[i] === "'") {
          const end = src.indexOf(src[i]!, i + 1)
          value = JSON.stringify(src.slice(i + 1, end))
          i = end + 1
        } else if (src[i] === '{') {
          const e = code(src, i + 1, true)
          value = `(${e.s})`
          i = e.i + 1
        }
      }
      props.push(`${JSON.stringify(attr[0])}: ${value}`)
    }
  }
  const children: string[] = []
  if (!closed) {
    for (;;) {
      if (src.startsWith('</', i)) {
        i = src.indexOf('>', i) + 1
        break
      }
      if (src[i] === '{') {
        let j = ws(src, i + 1)
        if (src.startsWith('/*', j)) { i = ws(src, src.indexOf('*/', j) + 2) + 1; continue }
        if (src[j] === '}') { i = j + 1; continue }
        const spread = src.startsWith('...', j)
        if (spread) j += 3
        const e = code(src, j, true)
        children.push(spread ? `...(${e.s})` : `(${e.s})`)
        i = e.i + 1
        continue
      }
      if (src[i] === '<') {
        const e = element(src, i)
        children.push(e.s)
        i = e.i
        continue
      }
      let j = i
      while (j < src.length && src[j] !== '<' && src[j] !== '{') j++
      const text = jsxText(src.slice(i, j))
      if (text) children.push(JSON.stringify(text))
      i = j
      if (i >= src.length) throw new SyntaxError(`jsx: unclosed <${name}>`)
    }
  }
  const p = props.length ? `{ ${props.join(', ')} }` : 'null'
  return { s: `__h(${tag}, ${p}${children.length ? ', ' + children.join(', ') : ''})`, i }
}

/** JSX text as React reads it: lines trimmed where they meet a line break, blank lines dropped, joined by spaces. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const kept: string[] = []
  lines.forEach((l, n) => {
    let t = l.replace(/\t/g, ' ')
    if (n > 0) t = t.replace(/^ +/, '')
    if (n < lines.length - 1) t = t.replace(/ +$/, '')
    if (t) kept.push(t)
  })
  return kept.join(' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// Lays out the mod's own element trees (what band.tsx, pane.tsx and card.tsx return for surface 'desktop') as SVG,
// the way the Code tab of the desktop app draws them: Box is a flex box measured in cells, Text a line of runs in the
// app's monospace, Svg the mod's art embedded as is, Button a hotkey chip and a label. It knows only what the views
// use, which is enough to draw every band moment and pane screen from the mod's real code.

export type Theme = {
  name: 'dark' | 'light'
  bg: string
  surface: string
  raised: string
  line: string
  text: string
  dim: string
  faint: string
  chip: string
  link: string
}

export const THEMES: Record<'dark' | 'light', Theme> = {
  dark: { name: 'dark', bg: '#262624', surface: '#1f1e1c', raised: '#30302d', line: '#3d3c38', text: '#ecebe6', dim: '#a3a199', faint: '#55534d', chip: '#3a3935', link: '#8fb4f5' },
  light: { name: 'light', bg: '#f7f6f2', surface: '#ffffff', raised: '#efede7', line: '#dcd9d0', text: '#2a2925', dim: '#6f6d66', faint: '#c9c6bc', chip: '#e7e4dc', link: '#2f6fd8' },
}

/** One terminal cell on the desktop: the width of a monospace character and the height of a row. */
export const CELL = { w: 8, h: 20, font: 13 }
export const MONO = `ui-monospace,SFMono-Regular,'Cascadia Mono',Menlo,Consolas,monospace`

export type Node = { type: string | null; props: Record<string, unknown>; children: unknown[] }
type Box = { svg: string; w: number; h: number }
type Run = { text: string; color?: string; bold?: boolean; dim?: boolean; underline?: boolean }

const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && 'type' in n && 'children' in n
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const len = (s: string) => [...s].length
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d)

let embeds = 0

function kids(n: Node): Node[] {
  const out: Node[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(walk)
    else if (isNode(c) && c.type === null) c.children.forEach(walk)
    else if (isNode(c)) out.push(c)
    else if (typeof c === 'string' || typeof c === 'number') out.push({ type: '#text', props: { text: String(c) }, children: [] })
  }
  n.children.forEach(walk)
  return out
}

/** A Text's runs, nested styles inherited. */
function runs(n: Node, inherit: Run = { text: '' }): Run[] {
  const p = n.props
  const style: Run = {
    text: '',
    color: (p.color as string | undefined) ?? inherit.color,
    bold: (p.bold as boolean | undefined) ?? inherit.bold,
    dim: (p.dimColor as boolean | undefined) ?? inherit.dim,
    underline: (p.underline as boolean | undefined) ?? inherit.underline,
  }
  const out: Run[] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(walk)
    else if (typeof c === 'string' || typeof c === 'number') out.push({ ...style, text: String(c) })
    else if (isNode(c) && (c.type === 'Text' || c.type === null)) out.push(...runs(c, style))
  }
  n.children.forEach(walk)
  return out
}

function cut(rs: Run[], max: number): Run[] {
  const total = rs.reduce((s, r) => s + len(r.text), 0)
  if (total <= max) return rs
  const out: Run[] = []
  let left = Math.max(0, max - 1)
  for (const r of rs) {
    if (left <= 0) break
    const t = [...r.text].slice(0, left).join('')
    out.push({ ...r, text: t })
    left -= len(t)
  }
  const last = out.at(-1)
  if (last) last.text = last.text.trimEnd() + '…'
  return out
}

function wrapRuns(rs: Run[], max: number): Run[][] {
  const words: Run[] = []
  for (const r of rs) for (const part of r.text.split(/(\s+)/)) if (part) words.push({ ...r, text: part })
  const lines: Run[][] = [[]]
  let used = 0
  for (const w of words) {
    const n = len(w.text)
    if (used + n > max && used > 0) {
      if (/^\s+$/.test(w.text)) continue
      lines.push([])
      used = 0
    }
    if (used === 0 && /^\s+$/.test(w.text)) continue
    lines.at(-1)!.push(w)
    used += n
  }
  return lines
}

function textLine(rs: Run[], x: number, y: number, t: Theme): string {
  if (rs.every(r => r.text === '')) return ''
  const spans = rs.map(r => {
    const fill = r.color ?? (r.dim ? t.dim : t.text)
    const attrs = [`fill="${fill}"`, r.bold ? 'font-weight="700"' : '', r.underline ? 'text-decoration="underline"' : '', r.color && r.dim ? 'fill-opacity="0.7"' : '']
    return `<tspan ${attrs.filter(Boolean).join(' ')}>${esc(r.text)}</tspan>`
  }).join('')
  return `<text x="${x}" y="${y + Math.round(CELL.h * 0.7)}" font-size="${CELL.font}" xml:space="preserve">${spans}</text>`
}

/** Ids inside an embedded document are global in the page: give each embed its own. */
export function scopeIds(svg: string, prefix: string): string {
  const ids = new Set<string>()
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]!)
  if (!ids.size) return svg
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : m))
    .replace(/href="#([^"]+)"/g, (m, id: string) => (ids.has(id) ? `href="#${prefix}${id}"` : m))
}

/**
 * The mod's Svg placed as a group: browsers give a nested <svg> its own animation clock, which a recording cannot
 * seek or pause with the rest, so its viewBox becomes a transform instead.
 */
export function embed(source: string, x: number, y: number, w: number, h: number): string {
  const scoped = scopeIds(source, `e${++embeds}`)
  const open = /^<svg\b([^>]*)>/.exec(scoped)
  if (!open || !scoped.endsWith('</svg>')) throw new Error('view: an Svg source that is not one <svg>')
  const attrs = open[1]!
  const vb = /viewBox="([^"]+)"/.exec(attrs)?.[1]?.split(/[\s,]+/).map(Number) ?? [0, 0, w, h]
  const sx = w / vb[2]!, sy = h / vb[3]!
  const crisp = /shape-rendering="crispEdges"/.test(attrs) ? ' shape-rendering="crispEdges"' : ''
  const scale = sx === 1 && sy === 1 ? '' : ` scale(${+sx.toFixed(4)} ${+sy.toFixed(4)})`
  const shift = vb[0] || vb[1] ? ` translate(${-vb[0]!} ${-vb[1]!})` : ''
  return `<g transform="translate(${x} ${y})${scale}${shift}"${crisp}>${scoped.slice(open[0].length, -6)}</g>`
}

function chip(key: string, x: number, y: number, t: Theme, primary: boolean): { svg: string; w: number } {
  const w = Math.max(14, 6 + len(key) * 7)
  const fill = primary ? '#f2b33d' : t.chip
  const ink = primary ? '#241c08' : t.text
  return {
    svg: `<rect x="${x}" y="${y + 2}" width="${w}" height="${CELL.h - 4}" rx="4" fill="${fill}"/>`
      + `<text x="${x + w / 2}" y="${y + Math.round(CELL.h * 0.68)}" font-size="11" font-weight="700" text-anchor="middle" fill="${ink}">${esc(key)}</text>`,
    w,
  }
}

/** Natural and laid-out size of one node at most `avail` px wide. */
export function layout(n: Node, x: number, y: number, avail: number, t: Theme): Box {
  const p = n.props
  switch (n.type) {
    case '#text':
    case 'Text': {
      const rs = n.type === '#text' ? [{ text: String(p.text) }] : runs(n)
      const width = p.width !== undefined ? num(p.width) * CELL.w : avail
      const max = Math.max(1, Math.floor(width / CELL.w))
      if (p.wrap === 'wrap') {
        const lines = wrapRuns(rs, max)
        const w = Math.max(...lines.map(l => l.reduce((s, r) => s + len(r.text), 0))) * CELL.w
        return { svg: lines.map((l, i) => textLine(l, x, y + i * CELL.h, t)).join(''), w, h: lines.length * CELL.h }
      }
      const shown = cut(rs, max)
      const w = shown.reduce((s, r) => s + len(r.text), 0) * CELL.w
      return { svg: textLine(shown, x, y, t), w, h: CELL.h }
    }
    case 'Svg': {
      const w = num(p.width, 16), h = num(p.height, 16)
      return { svg: embed(String(p.source), x, y, w, h), w, h }
    }
    case 'Button': {
      const label = String(p.label ?? '')
      const primary = p.variant === 'primary'
      let svg = ''
      let cx = x
      if (p.hotkey) {
        const c = chip(String(p.hotkey), x, y, t, primary)
        svg += c.svg
        cx += c.w + 6
      }
      const color = p.color as string | undefined
      svg += textLine([{ text: label, bold: primary, dim: !!p.dimColor, ...(color ? { color } : {}) }], cx, y, t)
      const w = cx - x + len(label) * CELL.w
      return { svg, w, h: CELL.h }
    }
    case 'Link': {
      const rs = runs(n).map(r => ({ ...r, color: r.color ?? t.link, underline: true }))
      const shown = cut(rs, Math.max(1, Math.floor(avail / CELL.w)))
      return { svg: textLine(shown, x, y, t), w: shown.reduce((s, r) => s + len(r.text), 0) * CELL.w, h: CELL.h }
    }
    case 'Input': {
      const w = Math.min(avail, (num(p.width) || 28) * CELL.w)
      const ph = String(p.placeholder ?? p.value ?? '')
      return {
        svg: `<rect x="${x + 0.5}" y="${y + 1.5}" width="${w - 1}" height="${CELL.h - 3}" rx="5" fill="${t.surface}" stroke="${t.line}"/>`
          + textLine([{ text: ph, dim: true }], x + 6, y, t),
        w, h: CELL.h,
      }
    }
    case 'Box':
      return box(n, x, y, avail, t)
    default:
      return { svg: '', w: 0, h: 0 }
  }
}

function box(n: Node, x: number, y: number, avail: number, t: Theme): Box {
  const p = n.props
  const bordered = typeof p.borderStyle === 'string'
  const outer = p.width !== undefined ? Math.min(avail, num(p.width) * CELL.w) : avail
  const padX = bordered ? CELL.w : 0, padY = bordered ? 10 : 0
  const inner = outer - padX * 2
  const ix = x + padX, iy = y + padY
  const row = p.flexDirection === 'row'
  const list = kids(n)
  let svg = ''
  let w = 0, h = 0
  if (!row) {
    const gap = num(p.rowGap) * CELL.h
    let cy = iy
    list.forEach((c, i) => {
      const r = layout(c, ix, cy, inner, t)
      svg += r.svg
      cy += r.h + (i < list.length - 1 ? gap : 0)
      w = Math.max(w, r.w)
    })
    h = cy - iy
  } else {
    const gap = num(p.columnGap) * CELL.w
    const fixed = (c: Node) => c.type === 'Svg' || c.type === 'Button' || num(c.props.flexShrink, 1) === 0 || c.props.width !== undefined
    const natural = list.map(c => layout(c, 0, 0, fixed(c) ? inner : 100_000, t).w)
    const total = natural.reduce((s, v) => s + v, 0) + gap * Math.max(0, list.length - 1)
    const widths = [...natural]
    if (p.flexWrap !== 'wrap') {
      const flexible = list.map((c, i) => (fixed(c) ? -1 : i)).filter(i => i >= 0)
      if (total > inner && flexible.length) {
        const over = total - inner
        const room = flexible.reduce((s, i) => s + natural[i]!, 0)
        for (const i of flexible) widths[i] = Math.max(CELL.w * 4, natural[i]! - over * (natural[i]! / Math.max(1, room)))
      }
      const growers = list.map((c, i) => (num(c.props.flexGrow) > 0 ? i : -1)).filter(i => i >= 0)
      const used = widths.reduce((s, v) => s + v, 0) + gap * Math.max(0, list.length - 1)
      if (used < inner && growers.length) for (const i of growers) widths[i] = widths[i]! + (inner - used) / growers.length
    }
    const between = p.justifyContent === 'space-between' && list.length > 1 && p.flexWrap !== 'wrap'
    const spare = between ? Math.max(0, inner - widths.reduce((s, v) => s + v, 0)) / (list.length - 1) : gap
    let cx = ix, cy = iy, lineH = 0
    list.forEach((c, i) => {
      if (p.flexWrap === 'wrap' && cx > ix && cx + widths[i]! > ix + inner) {
        cx = ix
        cy += lineH + num(p.rowGap) * CELL.h
        lineH = 0
      }
      const r = layout(c, cx, cy, widths[i]!, t)
      svg += r.svg
      lineH = Math.max(lineH, r.h)
      cx += (num(c.props.flexGrow) > 0 || between ? widths[i]! : r.w) + spare
      w = Math.max(w, cx - spare - ix)
    })
    h = cy + lineH - iy
  }
  const W = p.width !== undefined || bordered ? outer : w + padX * 2
  const H = h + padY * 2
  if (bordered) {
    const stroke = (p.borderColor as string | undefined) ?? t.line
    const op = p.borderDimColor ? ' stroke-opacity="0.55"' : ''
    svg = `<rect x="${x + 3.5}" y="${y + 3.5}" width="${W - 7}" height="${H - 7}" rx="8" fill="none" stroke="${stroke}" stroke-width="1.5"${op}/>` + svg
  }
  return { svg, w: W, h: H }
}

/** A whole tree, as an SVG group, with its size. */
export function draw(tree: unknown, x: number, y: number, columns: number, t: Theme): Box {
  if (!isNode(tree)) return { svg: '', w: 0, h: 0 }
  const r = layout(tree, x, y, columns * CELL.w, t)
  return { svg: `<g font-family="${MONO}">${r.svg}</g>`, w: r.w, h: r.h }
}

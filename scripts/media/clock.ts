// Turns a list of scenes into one looping SVG "recording". Each scene is drawn by the mod's own views at the moment it
// starts, and the mod's SMIL inside it was written to play once from 0. To loop the whole recording with no script,
// every animation is rewritten as one keyframed animation over the whole loop (begin 0, dur = the loop, repeating):
// its base value until the scene reaches its begin, its own keyframes (repeats unrolled) while it runs, then its frozen
// or base value. Each scene shows only during its own window. No syncbase timing, so every browser plays it the same.

export type Scene = { at: number; ms: number; svg: string }

const EPS = 1
const LINEAR = '0 0 1 1'
const sec = (ms: number) => `${+(ms / 1000).toFixed(3)}s`

function seconds(v: string | undefined): number | null {
  if (v === undefined) return 0
  const m = /^\s*(-?[\d.]+)(ms|s)?\s*$/.exec(v)
  if (!m) return null
  return Number(m[1]) * (m[2] === 'ms' ? 1 : 1000)
}

function attrsOf(s: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out.set(m[1]!, m[2]!)
  return out
}

const DEFAULTS: Record<string, string> = { visibility: 'inherit', display: 'inline', opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1' }

function identity(type: string, first: string): string {
  const n = first.trim().split(/[\s,]+/)
  if (type === 'translate') return n.map(() => '0').join(' ')
  if (type === 'scale') return n.map(() => '1').join(' ')
  if (type === 'rotate') return ['0', ...n.slice(1)].join(' ')
  return '0'
}

function baseOf(tag: string, a: Map<string, string>, parent: Map<string, string>, first: string): string {
  const name = a.get('attributeName')!
  if (tag === 'animateTransform') {
    const type = a.get('type') ?? 'translate'
    if (a.get('additive') === 'sum') return identity(type, first)
    const own = parent.get(name)
    if (own === undefined) return identity(type, first)
    const m = new RegExp(`^\\s*${type}\\(([^)]*)\\)\\s*$`).exec(own)
    if (!m) throw new Error(`clock: cannot loop a ${type} over transform="${own}"`)
    return m[1]!.replace(/,/g, ' ').trim()
  }
  const own = parent.get(name) ?? DEFAULTS[name]
  if (own === undefined) throw new Error(`clock: no base value for ${name}`)
  return own
}

const nums = (v: string) => v.trim().split(/[\s,]+/).map(Number)
function lerp(a: string, b: string, f: number): string {
  const x = nums(a), y = nums(b)
  if (x.length !== y.length || x.some(Number.isNaN) || y.some(Number.isNaN)) return f < 1 ? a : b
  return x.map((v, i) => +(v + (y[i]! - v) * f).toFixed(3)).join(' ')
}

type Point = { t: number; v: string; sp: string }
type Mode = 'discrete' | 'linear' | 'spline'
/** An animation over the whole loop: its value at every time (base outside its run), when it runs, its priority. */
type Conv = { name: string; keep: string; key: string; additive: boolean; mode: Mode; pts: Point[]; on: number; off: number; prio: number; base: string }

function emit(c: Pick<Conv, 'name' | 'keep' | 'mode' | 'pts'>, D: number): string {
  const kt = c.pts.map(p => Math.min(1, Math.max(0, p.t / D)))
  for (let i = 1; i < kt.length; i++) if (kt[i]! <= kt[i - 1]!) kt[i] = kt[i - 1]! + 1e-6
  const k = kt.map(t => +t.toFixed(6))
  const discrete = c.mode === 'discrete'
  const splines = c.pts.slice(1).map(p => p.sp)
  const sp = !discrete && splines.some(x => x !== LINEAR) ? ` keySplines="${splines.join(';')}"` : ''
  const m = discrete ? 'discrete' : sp ? 'spline' : 'linear'
  return `<${c.name}${c.keep} values="${c.pts.map(p => p.v).join(';')}" keyTimes="${k.join(';')}" calcMode="${m}"${sp} dur="${sec(D)}" repeatCount="indefinite"/>`
}

/** A value over the loop, built left to right. */
class Track {
  pts: Point[]
  mode: Mode
  constructor(mode: Mode, base: string) {
    this.mode = mode
    this.pts = [{ t: 0, v: base, sp: LINEAR }]
  }
  last(): Point { return this.pts[this.pts.length - 1]! }
  /** the value changes at once at t */
  jump(t: number, v: string): void {
    if (this.mode !== 'discrete' && t > this.last().t + EPS) this.pts.push({ t: t - EPS, v: this.last().v, sp: LINEAR })
    if (t <= this.last().t) { this.last().v = v; return }
    this.pts.push({ t, v, sp: LINEAR })
  }
  /** the value moves to v by t */
  ramp(t: number, v: string, sp = LINEAR): void {
    if (this.mode === 'discrete') return this.jump(t, v)
    if (t <= this.last().t) { this.last().v = v; return }
    this.pts.push({ t, v, sp })
  }
  close(D: number): Point[] {
    if (this.mode !== 'discrete' && this.last().t < D) this.pts.push({ t: D, v: this.last().v, sp: LINEAR })
    return this.pts
  }
}

function sample(c: Conv, t: number): string {
  let i = 0
  while (i + 1 < c.pts.length && c.pts[i + 1]!.t <= t) i++
  const p = c.pts[i]!, q = c.pts[i + 1]
  if (c.mode === 'discrete' || !q) return p.v
  return lerp(p.v, q.v, (t - p.t) / Math.max(1e-9, q.t - p.t))
}

/** One animation over the loop; a string to keep as it is, or null when it never shows inside its scene's window. */
function convert(tag: string, raw: string, parent: Map<string, string>, X: number, L: number, D: number): Conv | string | null {
  const a = attrsOf(raw)
  const b = seconds(a.get('begin'))
  if (b === null) throw new Error(`clock: unsupported begin "${a.get('begin')}"`)
  const repeat = a.get('repeatCount')
  // ambient loops already running from the start keep their own period: their phase does not matter
  if (repeat === 'indefinite' && b <= 0 && tag !== 'set') return `<${tag}${raw}/>`
  const s = X + b, e = X + L
  const freeze = a.get('fill') === 'freeze'
  const name = tag === 'animateTransform' ? 'animateTransform' : 'animate'
  const keep = ['attributeName', 'type', 'additive', 'accumulate'].filter(k => a.has(k)).map(k => ` ${k}="${a.get(k)}"`).join('')
  const conv = (mode: Mode, pts: Point[], on: number, off: number, base: string): Conv =>
    ({ name, keep, key: `${name}|${a.get('attributeName')}|${a.get('type') ?? ''}`, additive: a.get('additive') === 'sum', mode, pts, on, off, prio: s, base })

  if (tag === 'set') {
    const to = a.get('to')!
    const base = baseOf(tag, a, parent, to)
    const dur = !freeze && a.has('dur') ? seconds(a.get('dur')) ?? Infinity : Infinity
    const on = Math.max(s, 0), off = Math.min(e, s + dur)
    if (off <= X || on >= e) return null
    const tr = new Track('discrete', base)
    tr.jump(on, to)
    if (off < D) tr.jump(off, base)
    return conv('discrete', tr.close(D), on, off, base)
  }

  let values = a.get('values')?.split(';')
  if (!values) {
    const from = a.get('from'), to = a.get('to')
    if (from === undefined || to === undefined) throw new Error('clock: an animation without values')
    values = [from, to]
  }
  const d = seconds(a.get('dur'))
  if (d === null || d <= 0) throw new Error('clock: an animation without a duration')
  const mode = (a.get('calcMode') ?? 'linear') as Mode | 'paced'
  if (mode === 'paced') throw new Error('clock: paced animations are not supported')
  const n = values.length
  const keys = a.get('keyTimes')?.split(';').map(Number) ?? values.map((_, i) => (mode === 'discrete' ? i / n : i / Math.max(1, n - 1)))
  const splines = mode === 'spline' ? a.get('keySplines')!.split(';').map(x => x.trim()) : values.slice(1).map(() => LINEAR)
  const count = repeat === undefined ? 1 : repeat === 'indefinite' ? Infinity : Number(repeat)
  const activeEnd = s + d * count
  const limit = Math.min(e, activeEnd)
  const base = baseOf(tag, a, parent, values[0]!)
  const off = freeze ? e : limit
  if (off <= X || s >= e) return null
  const tr = new Track(mode, base)
  if (limit <= X) {
    // finished before the scene shows, and frozen there
    tr.jump(X, values[n - 1]!)
    return conv(mode, tr.close(D), X, off, base)
  }
  const valueAt = (i0: number, t: number) => {
    const f = (t - i0) / d
    for (let j = 1; j < n; j++) {
      if (f <= keys[j]!) return mode === 'discrete' ? values[j - 1]! : lerp(values[j - 1]!, values[j]!, (f - keys[j - 1]!) / Math.max(1e-9, keys[j]! - keys[j - 1]!))
    }
    return values[n - 1]!
  }
  for (let i = Math.max(0, Math.floor((X - s) / d)); s + i * d < limit; i++) {
    const i0 = s + i * d
    if (i0 < X) tr.jump(X, valueAt(i0, X))
    else tr.jump(i0, values[0]!)
    for (let j = 1; j < n; j++) {
      const t = i0 + keys[j]! * d
      if (t <= X) continue
      if (t > limit) break
      tr.ramp(t, values[j]!, splines[j - 1] ?? LINEAR)
    }
    if (mode !== 'discrete' && i0 + d <= limit) tr.ramp(i0 + d, values[n - 1]!)
    if (i > 400) throw new Error('clock: too many repeats')
  }
  if (!freeze && activeEnd < e) tr.jump(activeEnd, base)
  return conv(mode, tr.close(D), Math.max(s, X), off, base)
}

/** Several animations of one attribute on one element as one: at each moment, the one SMIL would let win. */
function merge(list: Conv[], D: number): Conv {
  const mode: Mode = list.every(c => c.mode === 'discrete') ? 'discrete' : 'linear'
  const tr = new Track(mode, list[0]!.base)
  const bounds = [...new Set([0, D, ...list.flatMap(c => [c.on, c.off])])].filter(t => t >= 0 && t <= D).sort((x, y) => x - y)
  for (let k = 0; k + 1 < bounds.length; k++) {
    const t0 = bounds[k]!, t1 = bounds[k + 1]!
    let w: Conv | null = null
    for (const c of list) if (c.on <= t0 && t0 < c.off && (!w || c.prio >= w.prio)) w = c
    if (!w) { tr.jump(t0, list[0]!.base); continue }
    tr.jump(t0, sample(w, t0))
    for (const p of w.pts) {
      if (p.t <= t0 || p.t >= t1) continue
      if (w.mode === 'discrete') tr.jump(p.t, p.v)
      else tr.ramp(p.t, p.v, p.sp)
    }
    if (mode !== 'discrete' && w.mode !== 'discrete') tr.ramp(t1, sample(w, t1))
  }
  return { ...list[0]!, mode, pts: tr.close(D) }
}

/** Every SMIL animation in a scene's svg onto the loop: the scene shows from `X` for `L` ms of a `D` ms loop. */
export function loop(svg: string, X: number, L: number, D: number): string {
  const stack: { id: number; attrs: Map<string, string> }[] = []
  let serial = 0
  const found: { slot: number; parent: number; conv: Conv }[] = []
  const marked = svg.replace(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g, (whole, close: string, tag: string, raw: string, self: string) => {
    if (close) { stack.pop(); return whole }
    if (/^(animate|set|animateTransform|animateMotion)$/.test(tag)) {
      if (!self) throw new Error(`clock: <${tag}> with children`)
      if (tag === 'animateMotion') throw new Error('clock: animateMotion is not supported')
      const top = stack[stack.length - 1]
      const c = convert(tag, raw, top?.attrs ?? new Map(), X, L, D)
      if (c === null || typeof c === 'string') return c ?? ''
      found.push({ slot: found.length, parent: top?.id ?? -1, conv: c })
      return `\u0000${found.length - 1}\u0000`
    }
    if (!self) stack.push({ id: ++serial, attrs: attrsOf(raw) })
    return whole
  })
  const text = new Map<number, string>()
  const groups = new Map<string, typeof found>()
  for (const f of found) {
    if (f.conv.additive) { text.set(f.slot, emit(f.conv, D)); continue }
    const g = `${f.parent}|${f.conv.key}`
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  for (const list of groups.values()) {
    text.set(list[0]!.slot, emit(list.length === 1 ? list[0]!.conv : merge(list.map(f => f.conv), D), D))
    for (const f of list.slice(1)) text.set(f.slot, '')
  }
  return marked.replace(/\u0000(\d+)\u0000/g, (_, i: string) => text.get(Number(i)) ?? '')
}

/** The scenes on one looping timeline of `total` ms: each shows only in its own window. */
export function compose(scenes: Scene[], total: number): string {
  return scenes.map(s => {
    const off = s.at + s.ms
    const values = ['none', 'inline', 'none'], times = [0, s.at / total, off / total]
    if (s.at <= 0) { values.shift(); times.shift() }
    if (off >= total) { values.pop(); times.pop() }
    const show = `<animate attributeName="display" values="${values.join(';')}" keyTimes="${times.map(t => +t.toFixed(6)).join(';')}" calcMode="discrete" dur="${sec(total)}" repeatCount="indefinite"/>`
    return `<g display="${s.at <= 0 ? 'inline' : 'none'}">${show}${loop(s.svg, s.at, s.ms, total)}</g>`
  }).join('')
}

// ---------- size ----------

/**
 * Runs of `<rect>`s of one colour (how the mod draws sprites) merged into one `<path>` per colour. The picture is
 * identical: a batch closes before any rect that would overlap one already in it, so paint order holds.
 */
export function compact(svg: string): string {
  return svg.replace(/(?:<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#[0-9a-f]{6}"\/>){2,}/g, run => {
    const rects = [...run.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9a-f]{6})"\/>/g)]
      .map(m => ({ x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]!, fill: m[5]! }))
    let out = ''
    let batch: typeof rects = []
    const flush = () => {
      const by = new Map<string, string>()
      for (const r of batch) by.set(r.fill, (by.get(r.fill) ?? '') + `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`)
      out += [...by].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('')
      batch = []
    }
    for (const r of rects) {
      if (batch.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) flush()
      batch.push(r)
    }
    flush()
    return out
  })
}

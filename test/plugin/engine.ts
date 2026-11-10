// Claude Code beneath the plugin, for the end-to-end tests: a store the test can read (and see every read of), the
// fake server, the UI calls recorded, and the file system and environment the mod may see: Claude Code's plugin list
// beside the installed copy (absent unless a test gives one), its lock, and the update variables. Every $.fs call is
// answered here, so no suite ever reaches a real file; a $.settings read is recorded and refused. Not a test file.
import type { On } from 'claude-code'
import { fakeServer } from './fixtures.ts'
import type { FakeServer } from './fixtures.ts'
import { LOCK_RE, REGISTRY_RE, b64 } from './registry.ts'

export const SESSION = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

export const RUN = (args: string) => ({ command: 'spin', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as never

export const PANE = (columns: number, surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'spinlings', component: 'Pane', requestId: 'spinlings', surface, viewport: { columns: columns + 4, rows: 40 },
  props: { title: 'Spinlings', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}) as const

export const BAND = (columns: number, surface: 'terminal' | 'desktop' = 'terminal', maxRows = 4) => ({
  plugin: 'spinlings', component: 'AbovePrompt', requestId: 'band', surface,
  props: { hasSurvey: false, isWorking: true, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
}) as const

export type Request = { url: string; method: string; headers: Record<string, string>; body: string }

/** The plugin list the mod finds, as a test sets it up and changes it; `text` null is no file at all. */
export type Files = {
  text: string | null
  /** Claude Code's lock beside it, `<list>.lock`, with its mtime; null when there is none */
  lock: { mtimeMs: number } | null
  /** what $.env.get answers; a name not here is unset */
  env: Record<string, string>
  /** every write of the list, in order */
  writes: { path: string; text: string }[]
}

export const files = (text: string | null = null, env: Record<string, string> = {}): Files => ({ text, lock: null, env, writes: [] })

export type Engine = {
  store: Map<string, unknown>
  /** every $.store key read, in order */
  reads: string[]
  server: FakeServer
  requests: Request[]
  status: (string | undefined)[]
  logs: string[]
  toasts: string[]
  sounds: string[]
  /** what reached a clipboard */
  copied: string[]
  /** every copy asked for, and the surface it was asked on */
  copies: { text: string; surface: string }[]
  opened: number
  /** whether each $.ui.open asked for the keyboard, in order */
  opens: boolean[]
  files: Files
  /** every $.fs call the mod made, `<method> <path>` */
  fs: string[]
  /** every $.env name the mod read */
  envReads: string[]
  /** $.settings reads (refused): there must be none */
  settings: number
}

/** Optional response delay runs after the fixture answer is captured; ordinary hooks still return synchronously. */
export function engine(on: On, server: FakeServer = fakeServer(), afterResponse?: (request: Request) => Promise<void> | void, list: Files = files()): Engine {
  const w: Engine = {
    store: new Map(), reads: [], server, requests: [], status: [], logs: [], toasts: [], sounds: [], copied: [], copies: [], opened: 0, opens: [],
    files: list, fs: [], envReads: [], settings: 0,
  }
  on('fs.read', (_$, e) => {
    w.fs.push(`read ${e.path}`)
    if (!REGISTRY_RE.test(e.path) || list.text === null) return { deny: 'ENOENT: no such file' }
    return { value: e.as === 'bytes' ? { base64: b64(list.text) } : list.text }
  })
  on('fs.stat', (_$, e) => {
    w.fs.push(`stat ${e.path}`)
    if (REGISTRY_RE.test(e.path) && list.text !== null) return { value: { kind: 'file', size: new TextEncoder().encode(list.text).length, mtimeMs: 0, isLink: false } }
    if (LOCK_RE.test(e.path) && list.lock) return { value: { kind: 'dir', size: 0, mtimeMs: list.lock.mtimeMs, isLink: false } }
    return { deny: 'ENOENT: no such file' }
  })
  on('fs.write', (_$, e) => {
    w.fs.push(`write ${e.path}`)
    list.writes.push({ path: e.path, text: e.text })
    if (REGISTRY_RE.test(e.path)) list.text = e.text
    return { value: undefined }
  })
  on('fs.list', (_$, e) => { w.fs.push(`list ${e.path}`); return { deny: 'not here' } })
  on('fs.exists', (_$, e) => { w.fs.push(`exists ${e.path}`); return { deny: 'not here' } })
  on('env.get', (_$, e) => { w.envReads.push(e.name); return { value: list.env[e.name] } })
  on('settings.read', () => { w.settings++; return { deny: 'the mod never reads settings' } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'engine answer' }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('store.get', (_$, e) => { w.reads.push(e.key); return { value: w.store.get(e.key) } })
  on('store.set', (_$, e) => { w.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('http.fetch', (_$, e) => {
    const request = { url: e.url, method: e.init?.method ?? 'GET', headers: { ...(e.init?.headers ?? {}) }, body: e.init?.body ?? '' }
    w.requests.push(request)
    try {
      const answer = server.handle(e.url, e.init)
      const paused = afterResponse?.(request)
      return paused ? paused.then(() => ({ value: answer })) : { value: answer }
    } catch {
      return { deny: 'no network' }
    }
  })
  on('audio.play', (_$, e) => {
    if (typeof e.clip.base64 !== 'string' || e.clip.mime !== 'audio/wav' || e.clip.asset !== undefined || e.clip.url !== undefined) {
      throw new Error('Game sound must use a locally synthesized WAV, without a file or URL')
    }
    w.sounds.push(e.clip.base64)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => { w.status.push(e.text); return { value: undefined } })
  on('ui.log', (_$, e) => { if (e.to !== 'debug') w.logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { w.opened++; w.opens.push(e.focus === true); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  // as this build answers: the terminal writes as /copy does, and a remote surface (the desktop) has no path yet
  on('ui.copy', (_$, e) => {
    const surface = e.surface ?? SESSION.surface
    w.copies.push({ text: e.text, surface })
    if (surface !== 'terminal') return { value: { isCopied: false, reason: 'no-clipboard' } }
    w.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return w
}

export async function settle(clock: { settle(): Promise<void> }, n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await clock.settle()
}

// ---------- measuring a drawn tree in terminal cells ----------

export type Node = { type: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }
export const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null && typeof (n as Node).type === 'string'

export function textOf(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (!isNode(n)) return ''
  if (n.type === 'Button') return String(n.props?.label ?? '')
  return (n.children ?? []).map(textOf).join('')
}

export function walk(n: unknown, out: Node[] = []): Node[] {
  if (!isNode(n)) return out
  out.push(n)
  for (const k of n.children ?? []) walk(k, out)
  return out
}

/**
 * The least width and the rows a node takes `avail` cells across: Rasters and buttons are rigid, truncating text
 * shrinks, wrapping text needs its longest word (up to the line). A Box narrower than its rigid content lands in
 * `problems`.
 */
export function measure(n: unknown, avail: number, problems: string[]): { w: number; h: number } {
  if (typeof n === 'string') return { w: [...n].length, h: 1 }
  if (!isNode(n)) return { w: 0, h: 0 }
  const p = n.props ?? {}
  const kids = n.children ?? []
  switch (n.type) {
    case 'Raster': return { w: Number(p.columns), h: Number(p.rows) }
    case 'Svg': return { w: 0, h: 0 }
    case 'Button': {
      const label = String(p.label ?? textOf(n))
      return { w: [...label].length + (p.hotkey ? String(p.hotkey).length + 2 : 0) + (p.plain ? 0 : 4), h: 1 }
    }
    case 'Text': {
      const s = textOf(n)
      const len = [...s].length
      if (String(p.wrap ?? 'wrap').startsWith('truncate')) return { w: Math.min(len, 1), h: 1 }
      // wrapping text breaks a word longer than the line (a link) hard, as the terminal's renderer does
      const word = Math.max(0, ...s.split(/\s+/).map(x => [...x].length))
      return { w: Math.min(word, Math.max(1, avail)), h: Math.max(1, Math.ceil(len / Math.max(1, avail))) }
    }
    case 'Box': {
      if (p.display === 'none') return { w: 0, h: 0 }
      const width = typeof p.width === 'number' ? p.width : null
      const border = p.borderStyle ? 2 : 0
      const inner = (width ?? avail) - border
      const row = String(p.flexDirection ?? 'row').startsWith('row')
      const gap = Number(row ? p.columnGap ?? p.gap ?? 0 : p.rowGap ?? p.gap ?? 0)
      const parts = kids.map(k => measure(k, inner, problems)).filter(x => x.w > 0 || x.h > 0)
      let w: number, h: number
      if (row && p.flexWrap === 'wrap') {
        w = Math.max(0, ...parts.map(x => x.w))
        const total = parts.reduce((s, x) => s + x.w, 0) + gap * Math.max(0, parts.length - 1)
        h = Math.max(1, Math.ceil(total / Math.max(1, inner))) * Math.max(1, ...parts.map(x => x.h))
      } else if (row) {
        w = parts.reduce((s, x) => s + x.w, 0) + gap * Math.max(0, parts.length - 1)
        h = Math.max(0, ...parts.map(x => x.h))
      } else {
        w = Math.max(0, ...parts.map(x => x.w))
        h = parts.reduce((s, x) => s + x.h, 0) + gap * Math.max(0, parts.length - 1)
      }
      w += border
      h += border
      if (width !== null && w > width) problems.push(`a ${row ? 'row' : 'column'} needs ${w} cells inside width ${width}`)
      return { w: width ?? w, h }
    }
    default: return { w: textOf(n).length, h: 1 }
  }
}

/**
 * The card art among drawn Rasters or Svgs: what a card, a reveal or a creature draws, leaving out the header's pack
 * meter and the packs waiting on the Team tab, which are art too.
 */
export function cardArt<T extends { key?: string | undefined; props: Record<string, unknown> }>(found: readonly T[]): T[] {
  return found.filter(n => !/^pack-.+-art$/.test(String(n.key ?? n.props.key ?? '')) && !/^(next pack|Open some packs)|waiting to open$/.test(String(n.props.alt ?? '')))
}

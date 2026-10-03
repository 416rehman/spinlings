// Display text. Every string that came from a server goes through `safe` before it is drawn (SPEC 12), and these are
// the small formatters the band, the pane and the status line share. Pure.
import { cleanText } from '../core/schemas.ts'

/** Untrusted text made drawable: escape sequences, control and bidi characters gone, cut to `max` code points. */
export function safe(s: unknown, max = 80): string {
  return cleanText(s, max)
}

/** Fits a line into `max` cells, ending in an ellipsis when cut. Never cuts inside a code point. */
export function fit(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : chars.slice(0, Math.max(0, max - 1)).join('') + '…'
}

/** Cells a string takes, counting code points (every glyph the mod draws is width 1). */
export function cells(s: string): number {
  return Array.from(s).length
}

/** `3 min`, `1 h 5 min`, `2 days`: a short span for timers. */
export function span(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`
  return plural(Math.floor(h / 24), 'day')
}

/** A text bar of `width` cells for a fraction 0..1: `███░░`. */
export function bar(fraction: number, width = 10): string {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const full = f > 0 ? Math.max(1, Math.round(f * width)) : 0
  return '█'.repeat(full) + '░'.repeat(width - full)
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

export function title(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

/** `3:40 PM` local time for a timestamp (ms or ISO string); '' when unreadable. */
export function clockTime(at: unknown): string {
  const t = typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return ''
  try {
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** A UTC day as other players' activity may be shown (SPEC 20.3): "today", "yesterday" or the date. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return 'today'
  const t = Date.parse(today + 'T00:00:00Z'), d = Date.parse(day + 'T00:00:00Z')
  if (Number.isFinite(t) && Number.isFinite(d) && t - d === 86_400_000) return 'yesterday'
  return safe(day, 10)
}

/** `a · b · c`, skipping empty parts. */
export function dots(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ')
}

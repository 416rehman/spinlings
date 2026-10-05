// Original chimes as inspectable notes and synthesis, not bundled recordings. Pure and deterministic;
// the optional audio effect sends the resulting WAV bytes to the engine's local player only.
import type { Chime } from './types.ts'

const RATE = 22_050
const PEAK = 0.45

type Note = { at: number; hz: number; ms: number; level?: number; glideTo?: number; shimmer?: boolean }

export const CHIME_NAMES = ['rare', 'legendary', 'evolve', 'first'] as const
const C6 = 1046.5, E6 = 1318.5, G5 = 784, G6 = 1568, B6 = 1975.5, C7 = 2093, D7 = 2349.3
const NOTES: Record<Chime, Note[]> = {
  rare: [{ at: 0, hz: E6, ms: 320, level: 0.8 }, { at: 90, hz: B6, ms: 380 }],
  legendary: [
    { at: 0, hz: C6, ms: 420, level: 0.7 }, { at: 85, hz: E6, ms: 420, level: 0.75 }, { at: 170, hz: G6, ms: 460, level: 0.8 },
    { at: 255, hz: C7, ms: 900, shimmer: true },
  ],
  evolve: [{ at: 0, hz: G5, ms: 560, glideTo: G6, level: 0.75 }, { at: 470, hz: D7, ms: 420, shimmer: true }],
  first: [
    { at: 0, hz: G5, ms: 500, level: 0.6 }, { at: 60, hz: C6, ms: 520, level: 0.65 }, { at: 120, hz: E6, ms: 560, level: 0.7 },
    { at: 300, hz: G6, ms: 950, shimmer: true },
  ],
}

/** A soft bell: a few partials, a 6 ms attack and an exponential fade, so nothing clicks. */
function bell(out: Float64Array, n: Note): void {
  const start = Math.round((n.at / 1000) * RATE)
  const len = Math.round((n.ms / 1000) * RATE)
  const level = n.level ?? 1
  const partials: [number, number][] = [[1, 1], [2, 0.32], [3, 0.12], [4.2, 0.05]]
  let phase = 0
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / RATE
    const hz = n.glideTo ? n.hz * Math.pow(n.glideTo / n.hz, Math.min(1, t / (len / RATE) / 0.7)) : n.hz
    phase += (2 * Math.PI * hz) / RATE
    const attack = Math.min(1, t / 0.006)
    const fade = Math.exp(-t * (5.5 / (n.ms / 1000)))
    const tremolo = n.shimmer ? 0.85 + 0.15 * Math.sin(2 * Math.PI * 7 * t) : 1
    let v = 0
    for (const [k, a] of partials) v += a * Math.sin(phase * k)
    out[start + i]! += v * attack * fade * tremolo * level
  }
}

function render(notes: Note[]): Float64Array {
  const ms = Math.max(...notes.map(n => n.at + n.ms))
  const out = new Float64Array(Math.ceil((ms / 1000) * RATE))
  for (const n of notes) bell(out, n)
  let max = 0
  for (const v of out) max = Math.max(max, Math.abs(v))
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! / max) * PEAK
  return out
}

/** 16-bit PCM mono, little-endian: the same bytes as the original shipped recordings. */
export function chimeWav(cue: Chime): Uint8Array {
  const samples = render(NOTES[cue])
  const bytes = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(bytes.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  text(36, 'data'); v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32_767), true))
  return bytes
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out.push(ALPHABET[n >>> 18]!, ALPHABET[(n >>> 12) & 63]!,
      i + 1 < bytes.length ? ALPHABET[(n >>> 6) & 63]! : '=', i + 2 < bytes.length ? ALPHABET[n & 63]! : '=')
  }
  return out.join('')
}

const cached = new Map<Chime, string>()
/** Immutable encoded clips are made once, on the first enabled playback of each cue. */
export function chimeClip(cue: Chime): { base64: string; mime: 'audio/wav' } {
  let bytes = cached.get(cue)
  if (!bytes) {
    bytes = base64(chimeWav(cue))
    cached.set(cue, bytes)
  }
  return { base64: bytes, mime: 'audio/wav' }
}

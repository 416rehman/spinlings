// A minimal CBOR (RFC 8949) decoder for WebAuthn's attestation objects and COSE keys (SPEC 30):
// our own, no dependencies. CTAP2 writes canonical CBOR, so indefinite lengths are refused; depth,
// sizes and integers are bounded, map keys must be integers or text and may not repeat. Tags are
// read through to their content.

export type CborMap = Map<number | string, CborValue>
export type CborValue = number | string | Uint8Array | boolean | null | undefined | CborValue[] | CborMap

export class CborError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CborError'
  }
}

const MAX_DEPTH = 16
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** One CBOR item that must fill `bytes` exactly. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, end } = decodeCborPrefix(bytes)
  if (end !== bytes.length) throw new CborError('trailing bytes')
  return value
}

/** One CBOR item starting at `offset`, and where it ends (authenticator data runs on after its COSE key). */
export function decodeCborPrefix(bytes: Uint8Array, offset = 0): { value: CborValue; end: number } {
  const r = { bytes, pos: offset }
  const value = item(r, 0)
  return { value, end: r.pos }
}

type Reader = { bytes: Uint8Array; pos: number }

function take(r: Reader, n: number): Uint8Array {
  if (n > r.bytes.length - r.pos) throw new CborError('truncated')
  const out = r.bytes.slice(r.pos, r.pos + n)
  r.pos += n
  return out
}

function byte(r: Reader): number {
  if (r.pos >= r.bytes.length) throw new CborError('truncated')
  return r.bytes[r.pos++]!
}

/** The argument of an initial byte: its value, or the length that follows. */
function argument(r: Reader, info: number): number {
  if (info < 24) return info
  if (info > 27) throw new CborError(info === 31 ? 'indefinite length' : 'reserved value')
  const size = 1 << (info - 24)
  let n = 0
  for (const b of take(r, size)) n = n * 256 + b
  if (!Number.isSafeInteger(n)) throw new CborError('integer too large')
  return n
}

function half(bits: number): number {
  const exp = (bits >> 10) & 0x1f, frac = bits & 0x3ff
  const v = exp === 0 ? frac * 2 ** -24 : exp === 31 ? (frac ? NaN : Infinity) : (1 + frac / 1024) * 2 ** (exp - 15)
  return bits & 0x8000 ? -v : v
}

function item(r: Reader, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError('nested too deep')
  const first = byte(r)
  const major = first >> 5, info = first & 31
  if (major === 7) {
    if (info === 20) return false
    if (info === 21) return true
    if (info === 22) return null
    if (info === 23) return undefined
    const raw = info >= 25 && info <= 27 ? take(r, 1 << (info - 24)) : null
    if (!raw) throw new CborError('unsupported simple value')
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    return info === 25 ? half(view.getUint16(0)) : info === 26 ? view.getFloat32(0) : view.getFloat64(0)
  }
  const n = argument(r, info)
  switch (major) {
    case 0: return n
    case 1: return -1 - n
    case 2: return take(r, n)
    case 3:
      try {
        return utf8.decode(take(r, n))
      } catch (err) {
        if (err instanceof CborError) throw err
        throw new CborError('bad text')
      }
    case 4: {
      if (n > r.bytes.length - r.pos) throw new CborError('truncated')
      const out: CborValue[] = []
      for (let i = 0; i < n; i++) out.push(item(r, depth + 1))
      return out
    }
    case 5: {
      if (n * 2 > r.bytes.length - r.pos) throw new CborError('truncated')
      const out: CborMap = new Map()
      for (let i = 0; i < n; i++) {
        const key = item(r, depth + 1)
        if (typeof key !== 'number' && typeof key !== 'string') throw new CborError('map key must be an integer or text')
        if (out.has(key)) throw new CborError('duplicate map key')
        out.set(key, item(r, depth + 1))
      }
      return out
    }
    default: // 6: a tag; its content is what matters here
      return item(r, depth + 1)
  }
}

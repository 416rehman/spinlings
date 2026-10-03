// A software authenticator for the passkey tests: real ES256 / RS256 keys from WebCrypto, CTAP2-style
// authenticator data, CBOR attestation objects ('none') and DER signatures, plus a tiny CBOR encoder.
// Every field can be bent to make the server's checks fail. The site engineer's page tests can use it.
import { sha256 } from '../../plugin/hooks/core/sha256.ts'
import { b64urlDecode, b64urlEncode, FLAG } from '../../server/src/game/passkeys.ts'

export type Cbor = number | string | Uint8Array | boolean | null | Cbor[] | Map<number | string, Cbor>

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n]
  if (n < 0x100) return [(major << 5) | 24, n]
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 255]
  if (n < 0x100000000) return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]
  const word = (w: number) => [(w >>> 24) & 255, (w >> 16) & 255, (w >> 8) & 255, w & 255]
  return [(major << 5) | 27, ...word(Math.floor(n / 0x100000000)), ...word(n >>> 0)]
}

/** Canonical-enough CBOR for tests: definite lengths, integers, bytes, text, arrays, maps, booleans, null. */
export function cbor(v: Cbor): Uint8Array {
  const out: number[] = []
  const put = (x: Cbor) => {
    if (typeof x === 'number') out.push(...(x >= 0 ? head(0, x) : head(1, -1 - x)))
    else if (typeof x === 'string') { const b = new TextEncoder().encode(x); out.push(...head(3, b.length), ...b) }
    else if (x instanceof Uint8Array) out.push(...head(2, x.length), ...x)
    else if (x === false) out.push(0xf4)
    else if (x === true) out.push(0xf5)
    else if (x === null) out.push(0xf6)
    else if (Array.isArray(x)) { out.push(...head(4, x.length)); x.forEach(put) }
    else { out.push(...head(5, x.size)); for (const [k, val] of x) { put(k); put(val) } }
  }
  put(v)
  return new Uint8Array(out)
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255])
const enc = (s: string) => new TextEncoder().encode(s)

/** WebCrypto's r || s as the DER SEQUENCE authenticators send. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    const v = b.slice(i)
    const body = v[0]! & 0x80 ? concat(new Uint8Array([0]), v) : v
    return concat(new Uint8Array([0x02, body.length]), body)
  }
  const half = raw.length / 2
  const seq = concat(int(raw.slice(0, half)), int(raw.slice(half)))
  return concat(new Uint8Array([0x30, seq.length]), seq)
}

export type CreateOptions = { rp: { id: string }; user: { id: string }; challenge: string }
export type GetOptions = { rpId: string; challenge: string }

/** Ways to bend a ceremony. */
export type Bend = {
  type?: string
  challenge?: string
  origin?: string
  crossOrigin?: boolean
  rpId?: string
  flags?: number
  counter?: number
  /** the credential id the page reports (registration) or presents (sign-in) */
  id?: string
  fmt?: string
  /** replaces the COSE key in the attested credential */
  cose?: Map<number | string, Cbor>
  /** flips a bit in the signature */
  badSignature?: boolean
  userHandle?: string | null
}

export type AddBody = { id: string; clientData: string; attestation: string }
export type SigninBody = { id: string; clientData: string; authenticator: string; signature: string; userHandle?: string }

export type Authenticator = {
  readonly alg: 'ES256' | 'RS256'
  /** base64url credential id */
  readonly id: string
  counter: number
  /** the user.id it was registered with (base64url) */
  userId: string | null
  create(options: CreateOptions, origin: string, bend?: Bend): Promise<AddBody>
  get(options: GetOptions, origin: string, bend?: Bend): Promise<SigninBody>
}

export async function softAuthenticator(alg: 'ES256' | 'RS256' = 'ES256', o: { counts?: boolean } = {}): Promise<Authenticator> {
  const params = alg === 'ES256'
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const keys = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const cose = alg === 'ES256'
    ? new Map<number | string, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, b64urlDecode(jwk.x!)], [-3, b64urlDecode(jwk.y!)]])
    : new Map<number | string, Cbor>([[1, 3], [3, -257], [-1, b64urlDecode(jwk.n!)], [-2, b64urlDecode(jwk.e!)]])
  const credential = crypto.getRandomValues(new Uint8Array(16))
  const counts = o.counts ?? true
  const clientData = (type: string, challenge: string, origin: string, b: Bend) =>
    enc(JSON.stringify({ type: b.type ?? type, challenge: b.challenge ?? challenge, origin: b.origin ?? origin, crossOrigin: b.crossOrigin ?? false }))

  const self: Authenticator = {
    alg,
    id: b64urlEncode(credential),
    counter: 0,
    userId: null,
    async create(options, origin, b = {}) {
      self.userId = options.user.id
      const authData = concat(
        sha256(b.rpId ?? options.rp.id),
        new Uint8Array([b.flags ?? (FLAG.UP | FLAG.UV | FLAG.AT)]),
        u32(b.counter ?? self.counter),
        new Uint8Array(16),
        new Uint8Array([0, credential.length]),
        credential,
        cbor(b.cose ?? cose),
      )
      const attestation = cbor(new Map<number | string, Cbor>([['fmt', b.fmt ?? 'none'], ['attStmt', new Map()], ['authData', authData]]))
      return {
        id: b.id ?? self.id,
        clientData: b64urlEncode(clientData('webauthn.create', options.challenge, origin, b)),
        attestation: b64urlEncode(attestation),
      }
    },
    async get(options, origin, b = {}) {
      if (counts && b.counter === undefined) self.counter++
      const data = clientData('webauthn.get', options.challenge, origin, b)
      const authData = concat(sha256(b.rpId ?? options.rpId), new Uint8Array([b.flags ?? (FLAG.UP | FLAG.UV)]), u32(b.counter ?? self.counter))
      const signed = concat(authData, sha256(data))
      const algorithm = alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }
      let sig = new Uint8Array(await crypto.subtle.sign(algorithm, keys.privateKey, signed as BufferSource))
      if (alg === 'ES256') sig = new Uint8Array(rawToDer(sig))
      if (b.badSignature) sig[sig.length - 1]! ^= 1
      const userHandle = b.userHandle === undefined ? self.userId : b.userHandle
      return {
        id: b.id ?? self.id,
        clientData: b64urlEncode(data),
        authenticator: b64urlEncode(authData),
        signature: b64urlEncode(sig),
        ...(userHandle ? { userHandle } : {}),
      }
    },
  }
  return self
}

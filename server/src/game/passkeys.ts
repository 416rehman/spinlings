// WebAuthn for the optional passkey (SPEC 30): registration with attestation 'none' and assertion,
// ES256 (ECDSA P-256) or RS256 (RSASSA-PKCS1-v1_5), verified with WebCrypto, COSE keys read by our
// own CBOR decoder. The two passkey pages (the site's) get their options from passkeyPage and post
// to the finish routes in routes/auth.ts, which call verifyRegistration / verifyAssertion.
import { sha256 } from '../../../plugin/hooks/core/sha256.ts'
import { CborError, decodeCbor, decodeCborPrefix } from './cbor.ts'
import type { CborMap, CborValue } from './cbor.ts'

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasskeyError'
  }
}

const no = (why: string): never => { throw new PasskeyError(why) }

// ---- base64url ---------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))
export const B64URL_RE = /^[A-Za-z0-9_-]*$/

export function b64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '') + (i + 2 < bytes.length ? B64[n & 63]! : '')
  }
  return out
}

/** Unpadded base64url; anything else (padding, other alphabets, a dangling character) is refused. */
export function b64urlDecode(s: string): Uint8Array {
  if (!B64URL_RE.test(s) || s.length % 4 === 1) no('bad base64url')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let bits = 0, value = 0, at = 0
  for (const c of s) {
    value = (value << 6) | B64_INDEX.get(c)!
    bits += 6
    if (bits >= 8) { out[at++] = (value >> (bits - 8)) & 255; bits -= 8 }
  }
  if ((value & ((1 << bits) - 1)) !== 0) no('bad base64url')
  return out
}

// ---- pieces ------------------------------------------------------------------------------------

export const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 } as const
export const ES256 = -7
export const RS256 = -257

export type PublicKey = { alg: typeof ES256 | typeof RS256; jwk: JsonWebKey }

type ClientData = { type: string; challenge: string; origin: string; crossOrigin?: boolean }

/** clientDataJSON, checked: the ceremony type, our challenge, our exact origin, not in a foreign frame. */
function clientData(bytes: Uint8Array, type: string, challenge: string, origin: string): void {
  let cd: ClientData
  try {
    cd = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ClientData
  } catch {
    return no('client data is not JSON')
  }
  if (typeof cd !== 'object' || cd === null) no('client data is not an object')
  if (cd.type !== type) no('wrong ceremony')
  if (cd.challenge !== challenge) no('wrong challenge')
  if (cd.origin !== origin) no('wrong origin')
  if (cd.crossOrigin === true) no('cross-origin')
}

export type AuthData = {
  rpIdHash: Uint8Array
  flags: number
  signCount: number
  credential?: { aaguid: Uint8Array; id: Uint8Array; publicKey: CborMap }
}

/** One CBOR item inside authenticator data: malformed CBOR is a passkey that did not check out. */
function cborAt(bytes: Uint8Array, pos: number): { value: CborValue; end: number } {
  try {
    return decodeCborPrefix(bytes, pos)
  } catch (err) {
    if (err instanceof CborError) no('bad CBOR')
    throw err
  }
}

/** Authenticator data (WebAuthn 6.1), with its attested credential when `attested`. */
export function parseAuthData(bytes: Uint8Array, attested: boolean): AuthData {
  if (bytes.length < 37) no('authenticator data too short')
  const flags = bytes[32]!
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0)
  const out: AuthData = { rpIdHash: bytes.slice(0, 32), flags, signCount }
  let pos = 37
  if (flags & FLAG.AT) {
    if (bytes.length < pos + 18) no('attested credential data too short')
    const aaguid = bytes.slice(pos, pos + 16)
    const idLength = (bytes[pos + 16]! << 8) | bytes[pos + 17]!
    pos += 18
    if (idLength < 1 || idLength > 1023 || bytes.length < pos + idLength) no('bad credential id')
    const id = bytes.slice(pos, pos + idLength)
    pos += idLength
    const key = cborAt(bytes, pos)
    if (!(key.value instanceof Map)) no('credential key is not a COSE key')
    pos = key.end
    out.credential = { aaguid, id, publicKey: key.value as CborMap }
  } else if (attested) no('no attested credential')
  if (flags & FLAG.ED) {
    const ext = cborAt(bytes, pos)
    if (!(ext.value instanceof Map)) no('bad extensions')
    pos = ext.end
  }
  if (pos !== bytes.length) no('trailing authenticator data')
  return out
}

const bytesAt = (m: CborMap, k: number): Uint8Array => {
  const v = m.get(k)
  return v instanceof Uint8Array ? v : no('bad COSE key')
}

const unpad = (b: Uint8Array) => {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  return b.slice(i)
}

/** A COSE key (RFC 9053) as a JWK: EC2 P-256 for ES256, RSA (2048-4096 bits) for RS256. */
export function coseKey(m: CborMap): PublicKey {
  const kty = m.get(1), alg = m.get(3)
  if (alg === ES256) {
    if (kty !== 2 || m.get(-1) !== 1) no('ES256 key must be EC2 on P-256')
    const x = bytesAt(m, -2), y = bytesAt(m, -3)
    if (x.length !== 32 || y.length !== 32) no('bad P-256 point')
    return { alg: ES256, jwk: { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y) } }
  }
  if (alg === RS256) {
    if (kty !== 3) no('RS256 key must be RSA')
    const n = unpad(bytesAt(m, -1)), e = unpad(bytesAt(m, -2))
    if (n.length < 256 || n.length > 512 || e.length < 1 || e.length > 8) no('bad RSA key size')
    return { alg: RS256, jwk: { kty: 'RSA', n: b64urlEncode(n), e: b64urlEncode(e), alg: 'RS256' } }
  }
  return no('only ES256 and RS256 are accepted')
}

function importKey(key: PublicKey): Promise<CryptoKey> {
  const algorithm = key.alg === ES256 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
  return crypto.subtle.importKey('jwk', key.jwk, algorithm, false, ['verify'])
}

/** An ASN.1 DER ECDSA signature (what authenticators send) as WebCrypto's r || s. */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array {
  const fail = () => no('bad signature encoding')
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) fail()
  const out = new Uint8Array(size * 2)
  let pos = 2
  for (let k = 0; k < 2; k++) {
    if (der[pos] !== 0x02) fail()
    const len = der[pos + 1]!
    let v = der.slice(pos + 2, pos + 2 + len)
    if (len < 1 || v.length !== len || v[0]! & 0x80) fail()
    v = unpad(v)
    if (v.length > size) fail()
    out.set(v, k * size + size - v.length)
    pos += 2 + len
  }
  if (pos !== der.length) fail()
  return out
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

function checkFlags(flags: number): void {
  if (!(flags & FLAG.UP)) no('user not present')
  if (flags & FLAG.BS && !(flags & FLAG.BE)) no('backup state without eligibility')
}

// ---- ceremonies --------------------------------------------------------------------------------

export type Expected = { challenge: string; origin: string; rpId: string }

export type Registration = { credentialId: string; key: PublicKey; signCount: number }

/**
 * navigator.credentials.create's result (WebAuthn 7.1). Attestation is not trusted for anything, so
 * any format is read as 'none' and its statement is ignored.
 */
export async function verifyRegistration(
  o: Expected & { credentialId: string; clientData: Uint8Array; attestation: Uint8Array },
): Promise<Registration> {
  clientData(o.clientData, 'webauthn.create', o.challenge, o.origin)
  let att: CborValue
  try {
    att = decodeCbor(o.attestation)
  } catch {
    return no('attestation is not CBOR')
  }
  if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !(att.get('attStmt') instanceof Map)) no('bad attestation object')
  const raw = (att as CborMap).get('authData')
  if (!(raw instanceof Uint8Array)) return no('bad attestation object')
  const ad = parseAuthData(raw, true)
  if (!sameBytes(ad.rpIdHash, sha256(o.rpId))) no('wrong relying party')
  checkFlags(ad.flags)
  const id = b64urlEncode(ad.credential!.id)
  if (id !== o.credentialId) no('credential id mismatch')
  const key = coseKey(ad.credential!.publicKey)
  try {
    await importKey(key)
  } catch {
    no('unusable public key')
  }
  return { credentialId: id, key, signCount: ad.signCount }
}

/**
 * navigator.credentials.get's result (WebAuthn 7.2) against a stored key. A non-zero signature
 * counter must climb, or the authenticator may be a clone. Returns the new counter.
 */
export async function verifyAssertion(
  o: Expected & { clientData: Uint8Array; authenticator: Uint8Array; signature: Uint8Array; key: PublicKey; signCount: number },
): Promise<{ signCount: number }> {
  clientData(o.clientData, 'webauthn.get', o.challenge, o.origin)
  const ad = parseAuthData(o.authenticator, false)
  if (!sameBytes(ad.rpIdHash, sha256(o.rpId))) no('wrong relying party')
  checkFlags(ad.flags)
  const signed = concat(o.authenticator, sha256(o.clientData))
  const signature = o.key.alg === ES256 ? derToRaw(o.signature) : o.signature
  const algorithm = o.key.alg === ES256 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }
  let ok = false
  try {
    ok = await crypto.subtle.verify(algorithm, await importKey(o.key), signature as BufferSource, signed as BufferSource)
  } catch {
    ok = false
  }
  if (!ok) no('bad signature')
  if ((ad.signCount !== 0 || o.signCount !== 0) && ad.signCount <= o.signCount) no('signature counter went backwards')
  return { signCount: ad.signCount }
}

/** The relying party id: the server origin's host (SPEC 31: spinlings.dev; localhost in development). */
export const rpIdOf = (origin: string): string => new URL(origin).hostname
